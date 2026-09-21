import { describe, expect, it } from 'vitest'

import { LOCALES } from '@/lib/i18n'
import { getQuestionContent, getTypeContent, UI } from '@/lib/mbti/content'
import { QUESTIONS } from '@/lib/mbti/questions'
import {
  groupOfType,
  MBTI_TYPES,
  TYPE_GROUPS,
  typesInGroup,
} from '@/lib/mbti/types'
import { isTokenShaped, mintToken, TOKEN_LENGTH } from '@/lib/tokens'

/**
 * Content completeness, checked at test time rather than discovered by a visitor.
 *
 * A missing translation does not throw at build - it renders as a blank line on a page
 * someone landed on from search. These are cheap tests that turn "silently wrong for one
 * locale" into a red CI run.
 */
describe('question content', () => {
  it('has wording for every question in every locale', () => {
    for (const locale of LOCALES)
      for (const question of QUESTIONS) {
        const content = getQuestionContent(locale, question.id)
        expect(
          content.prompt.length,
          `${locale} q${question.id} prompt`
        ).toBeGreaterThan(0)
        expect(
          content.a.length,
          `${locale} q${question.id} answer a`
        ).toBeGreaterThan(0)
        expect(
          content.b.length,
          `${locale} q${question.id} answer b`
        ).toBeGreaterThan(0)
      }
  })

  it('never gives a question two identical answers', () => {
    for (const locale of LOCALES)
      for (const question of QUESTIONS) {
        const content = getQuestionContent(locale, question.id)
        expect(content.a, `${locale} q${question.id}`).not.toBe(content.b)
      }
  })

  it('throws loudly for an id with no wording', () => {
    expect(() => getQuestionContent('vi', 9999)).toThrow(/Missing vi content/)
  })
})

describe('type content', () => {
  it('covers all 16 types in every locale', () => {
    for (const locale of LOCALES)
      for (const type of MBTI_TYPES) {
        const content = getTypeContent(locale, type)
        expect(
          content.tagline.length,
          `${locale} ${type} tagline`
        ).toBeGreaterThan(0)
        expect(
          content.overview.length,
          `${locale} ${type} overview`
        ).toBeGreaterThan(0)
        expect(
          content.strengths.length,
          `${locale} ${type} strengths`
        ).toBeGreaterThan(0)
        expect(
          content.growth.length,
          `${locale} ${type} growth`
        ).toBeGreaterThan(0)
        expect(
          content.inRelationships.length,
          `${locale} ${type}`
        ).toBeGreaterThan(0)
      }
  })

  it('localizes the nickname rather than leaving it in English', () => {
    // This assertion used to be the exact opposite - it required the two to match, which
    // is what let sixteen English labels sit in the middle of an otherwise Vietnamese
    // page. Inverted deliberately: a Vietnamese nickname equal to the English one now
    // fails, so the next type added cannot quietly ship untranslated.
    for (const type of MBTI_TYPES) {
      const vi = getTypeContent('vi', type).nickname
      expect(vi, `${type} nickname is untranslated`).not.toBe(
        getTypeContent('en', type).nickname
      )
      expect(vi, `${type} nickname looks English`).not.toMatch(/^The /)
    }
  })

  it('does not reuse a group label as a type nickname', () => {
    // "Analysts" as a section heading with "The Analyst" as a card inside it reads as a
    // rendering bug. Cheap to prevent, invisible until someone screenshots the page.
    for (const locale of LOCALES) {
      const groupLabels = new Set(
        TYPE_GROUPS.map(group => UI[locale].groupLabels[group].toLowerCase())
      )
      for (const type of MBTI_TYPES) {
        const nickname = getTypeContent(locale, type)
          .nickname.replace(/^The /, '')
          .toLowerCase()
        expect(
          groupLabels.has(nickname),
          `${locale} ${type} collides with a group label`
        ).toBe(false)
      }
    }
  })
})

describe('ui strings', () => {
  it('defines the same keys in every locale', () => {
    const [first, ...rest] = LOCALES
    const expected = Object.keys(UI[first]).sort()
    for (const locale of rest)
      expect(Object.keys(UI[locale]).sort(), `locale ${locale}`).toEqual(
        expected
      )
  })

  it('keeps both placeholders in the progress template', () => {
    for (const locale of LOCALES) {
      expect(UI[locale].questionProgress).toContain('{current}')
      expect(UI[locale].questionProgress).toContain('{total}')
    }
  })

  it('keeps the count placeholder in the test summary', () => {
    // Without it the landing page advertises a literal "{count} questions".
    for (const locale of LOCALES)
      expect(UI[locale].testMeta).toContain('{count}')
  })

  it('names every temperament group in every locale', () => {
    for (const locale of LOCALES)
      for (const group of TYPE_GROUPS)
        expect(
          UI[locale].groupLabels[group]?.length,
          `${locale} ${group}`
        ).toBeGreaterThan(0)
  })
})

describe('temperament groups', () => {
  it('assigns every type to exactly one group', () => {
    const grouped = TYPE_GROUPS.flatMap(group => typesInGroup(group))
    expect(grouped).toHaveLength(MBTI_TYPES.length)
    expect(new Set(grouped).size).toBe(MBTI_TYPES.length)
  })

  it('splits the sixteen types evenly, four per group', () => {
    // Four groups of four is what the landing page grid assumes; an uneven split there
    // would be a content bug that only shows up as a ragged row.
    for (const group of TYPE_GROUPS)
      expect(typesInGroup(group), group).toHaveLength(4)
  })

  it('follows the standard pairings', () => {
    // Intuitives group on T/F, sensors on J/P. Pinned because that asymmetry looks like a
    // typo to anyone reading `groupOfType` for the first time.
    expect(groupOfType('INTJ')).toBe('NT')
    expect(groupOfType('ENTP')).toBe('NT')
    expect(groupOfType('INFP')).toBe('NF')
    expect(groupOfType('ENFJ')).toBe('NF')
    expect(groupOfType('ISTJ')).toBe('SJ')
    expect(groupOfType('ESFJ')).toBe('SJ')
    expect(groupOfType('ISTP')).toBe('SP')
    expect(groupOfType('ESFP')).toBe('SP')
  })
})

describe('capability tokens', () => {
  it('mints URL-safe tokens of the expected length', () => {
    for (let i = 0; i < 50; i += 1) {
      const token = mintToken()
      expect(token).toHaveLength(TOKEN_LENGTH)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('does not collide across a large sample', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => mintToken()))
    expect(tokens.size).toBe(2000)
  })

  it('accepts its own output', () => {
    expect(isTokenShaped(mintToken())).toBe(true)
  })

  it('rejects anything that is not token-shaped', () => {
    expect(isTokenShaped(undefined)).toBe(false)
    expect(isTokenShaped('')).toBe(false)
    expect(isTokenShaped('short')).toBe(false)
    expect(isTokenShaped('a'.repeat(TOKEN_LENGTH + 1))).toBe(false)
    // Path traversal and injection attempts must not reach the database.
    expect(isTokenShaped('../../../etc/passwd')).toBe(false)
    expect(isTokenShaped('a'.repeat(TOKEN_LENGTH - 1) + '/')).toBe(false)
    expect(isTokenShaped('a'.repeat(TOKEN_LENGTH - 1) + '+')).toBe(false)
  })
})

/**
 * The paywall lead has to survive being read by someone who cannot see their type.
 *
 * This is the shape of a bug that shipped: the result page printed the four letters above
 * the paywall, so the lead opened with "You already know your type" and read fine. The
 * moment the type went behind the wall - which is where it belongs, the type being the
 * product - that sentence became a page telling a stranger they knew something the same
 * page was refusing to show them.
 *
 * Copy that presupposes what the gate is withholding cannot be caught by a type checker
 * and is invisible in review unless the reviewer happens to load a locked result. So it is
 * asserted, per locale, in both directions: the lead must promise the type and must not
 * assume it has already been seen.
 */
describe('the MBTI paywall lead', () => {
  it.each(LOCALES)(
    'promises the type rather than assuming it in %s',
    locale => {
      const lead = UI[locale].paywallLead.toLowerCase()

      // What is being sold, said out loud - the reader's own four letters.
      expect(lead).toMatch(/bốn chữ|four-letter/)

      // The presupposition that broke. Matching the phrasings rather than a single string, so
      // a reworded version of the same mistake still trips this.
      expect(lead).not.toMatch(/bạn đã biết|you already know|as you know/)
    }
  )

  it.each(LOCALES)('still interpolates the price in %s', locale => {
    // The rewrite above touched this string; a lost placeholder would render the paywall
    // with no number on it.
    expect(UI[locale].paywallLead).toContain('{price}')
  })
})
