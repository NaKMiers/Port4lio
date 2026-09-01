import { describe, expect, it } from 'vitest'

import { LOCALES } from '@/lib/i18n'
import { getTypeContent } from '@/lib/mbti/content'
import { typeFaqEntries } from '@/lib/mbti/seo'
import {
  FUNCTION_COPY,
  functionStack,
  LETTERS,
  lettersOf,
  ROLE_COPY,
  ROLE_HINT,
} from '@/lib/mbti/theory'
import { MBTI_TYPES } from '@/lib/mbti/types'

/**
 * MBTI theory rendered on the 32 type pages.
 *
 * The function stack is derived by rule rather than tabulated, which is efficient but
 * unforgiving: a subtly wrong rule produces a plausible-looking stack for every type and
 * publishes confidently incorrect theory on every indexed page. So the expected table
 * below is the published one, written out in full, and the derivation is checked against
 * all sixteen entries rather than a sample.
 */

/** The standard function stacks. Source of truth for the derivation, not derived from it. */
const PUBLISHED_STACKS: Record<string, string> = {
  ENTJ: 'Te Ni Se Fi',
  INTJ: 'Ni Te Fi Se',
  ENTP: 'Ne Ti Fe Si',
  INTP: 'Ti Ne Si Fe',
  ENFJ: 'Fe Ni Se Ti',
  INFJ: 'Ni Fe Ti Se',
  ENFP: 'Ne Fi Te Si',
  INFP: 'Fi Ne Si Te',
  ESTJ: 'Te Si Ne Fi',
  ISTJ: 'Si Te Fi Ne',
  ESFJ: 'Fe Si Ne Ti',
  ISFJ: 'Si Fe Ti Ne',
  ESTP: 'Se Ti Fe Ni',
  ISTP: 'Ti Se Ni Fe',
  ESFP: 'Se Fi Te Ni',
  ISFP: 'Fi Se Ni Te',
}

describe('functionStack', () => {
  it('matches the published stack for all sixteen types', () => {
    for (const type of MBTI_TYPES) {
      const derived = functionStack(type)
        .map(entry => entry.fn)
        .join(' ')
      expect(derived, type).toBe(PUBLISHED_STACKS[type])
    }
  })

  it('returns the four roles in order', () => {
    expect(functionStack('ENTJ').map(e => e.role)).toEqual([
      'dominant',
      'auxiliary',
      'tertiary',
      'inferior',
    ])
  })

  it('alternates attitude between dominant and auxiliary', () => {
    // A stack with two extraverted functions in the first two slots would be malformed;
    // the auxiliary exists to balance the dominant's direction.
    for (const type of MBTI_TYPES) {
      const [dominant, auxiliary] = functionStack(type)
      expect(dominant.fn[1], type).not.toBe(auxiliary.fn[1])
    }
  })

  it('never repeats a function within a stack', () => {
    for (const type of MBTI_TYPES) {
      const fns = functionStack(type).map(e => e.fn)
      expect(new Set(fns).size, type).toBe(4)
    }
  })

  it('pairs the inferior as the exact opposite of the dominant', () => {
    // Te <-> Fi, Ni <-> Se, and so on. This is the relationship the "blind spot under
    // stress" framing on the page depends on.
    const opposite: Record<string, string> = { T: 'F', F: 'T', S: 'N', N: 'S' }
    for (const type of MBTI_TYPES) {
      const [dominant, , , inferior] = functionStack(type)
      expect(inferior.fn[0], type).toBe(opposite[dominant.fn[0]])
      expect(inferior.fn[1], type).not.toBe(dominant.fn[1])
    }
  })
})

describe('letters', () => {
  it('decomposes a type into its four letters in order', () => {
    expect(lettersOf('vi', 'ENTJ').map(l => l.letter)).toEqual(['E', 'N', 'T', 'J'])
  })

  it('defines all eight letters in every locale', () => {
    for (const locale of LOCALES) {
      for (const letter of ['E', 'I', 'S', 'N', 'T', 'F', 'J', 'P'] as const) {
        const copy = LETTERS[locale][letter]
        expect(copy.name.length, `${locale} ${letter} name`).toBeGreaterThan(3)
        expect(copy.summary.length, `${locale} ${letter} summary`).toBeGreaterThan(40)
      }
    }
  })

  it('covers every type without a missing definition', () => {
    for (const locale of LOCALES) {
      for (const type of MBTI_TYPES) {
        const entries = lettersOf(locale, type)
        expect(entries).toHaveLength(4)
        expect(entries.every(e => e.summary.length > 0), `${locale} ${type}`).toBe(true)
      }
    }
  })
})

describe('function and role copy', () => {
  it('describes all eight functions in every locale', () => {
    for (const locale of LOCALES) {
      for (const fn of ['Te', 'Ti', 'Fe', 'Fi', 'Se', 'Si', 'Ne', 'Ni'] as const) {
        expect(FUNCTION_COPY[locale][fn].name.length, `${locale} ${fn}`).toBeGreaterThan(3)
        expect(FUNCTION_COPY[locale][fn].summary.length, `${locale} ${fn}`).toBeGreaterThan(30)
      }
    }
  })

  it('labels and explains all four roles in every locale', () => {
    for (const locale of LOCALES) {
      for (const role of ['dominant', 'auxiliary', 'tertiary', 'inferior'] as const) {
        expect(ROLE_COPY[locale][role].length).toBeGreaterThan(2)
        expect(ROLE_HINT[locale][role].length).toBeGreaterThan(20)
      }
    }
  })
})

describe('per-type FAQ', () => {
  it('produces a real question and answer for every type in every locale', () => {
    for (const locale of LOCALES) {
      for (const type of MBTI_TYPES) {
        const entries = typeFaqEntries(locale, type)
        expect(entries.length, `${locale} ${type}`).toBeGreaterThanOrEqual(5)

        for (const { q, a } of entries) {
          expect(q.length, `${locale} ${type} question`).toBeGreaterThan(6)
          // Short answers are what Google's helpful-content system reads as padding.
          expect(a.length, `${locale} ${type} answer: ${q}`).toBeGreaterThan(40)
          expect(a, `${locale} ${type} unfilled placeholder`).not.toMatch(/\{[a-z]+\}/)
        }
      }
    }
  })

  it('names the type in its own questions', () => {
    // The query these pages compete for is the type code itself.
    for (const type of MBTI_TYPES) {
      expect(typeFaqEntries('vi', type)[0].q).toContain(type)
    }
  })

  it('uses the right indefinite article in English', () => {
    // Every type code starts with E or I, both read as vowel sounds, so "a ENTJ" is wrong
    // for all sixteen - not an edge case worth hand-checking per type.
    for (const type of MBTI_TYPES) {
      const questions = typeFaqEntries('en', type).map(e => e.q).join(' ')
      expect(questions, type).not.toMatch(new RegExp(`\\ba ${type}\\b`))
    }
  })

  it('states the derived stack in the cognitive-functions answer', () => {
    const answer = typeFaqEntries('en', 'INFJ')[1].a
    expect(answer).toContain('Ni - Fe - Ti - Se')
  })

  it('grounds answers in the type content rather than inventing them', () => {
    const content = getTypeContent('vi', 'ISFP')
    const entries = typeFaqEntries('vi', 'ISFP')
    expect(entries.at(-1)?.a).toBe(content.inRelationships)
    expect(entries[2].a).toContain(content.strengths[0])
  })
})
