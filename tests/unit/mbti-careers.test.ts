import { describe, expect, it } from 'vitest'

import { LOCALES } from '@/lib/i18n'
import { getCareerContent } from '@/lib/mbti/content'
import { MBTI_TYPES } from '@/lib/mbti/types'

/**
 * Career content, which is the one section on the type pages written by hand rather than
 * composed.
 *
 * The tests that matter here are the anti-filler ones. Coverage is easy to satisfy with
 * sixteen copies of the same paragraph, and that would be worse than shipping nothing:
 * "nghề nghiệp phù hợp với X" is a high-intent query, and near-identical pages across a
 * site are exactly what Google's helpful-content system demotes. So the assertions below
 * check that the sixteen entries are actually *different from each other*, not merely
 * present.
 */

describe('career content coverage', () => {
  it('covers all sixteen types in every locale', () => {
    for (const locale of LOCALES) {
      for (const type of MBTI_TYPES) {
        const careers = getCareerContent(locale, type)
        expect(careers.workStyle.length, `${locale} ${type} workStyle`).toBeGreaterThan(80)
        expect(careers.thrivesIn.length, `${locale} ${type} thrivesIn`).toBeGreaterThan(40)
        expect(careers.drainedBy.length, `${locale} ${type} drainedBy`).toBeGreaterThan(40)
        expect(careers.roles.length, `${locale} ${type} roles`).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it('never repeats a role list between two types', () => {
    // The clearest signal of generated filler: two types that could swap pages unnoticed.
    for (const locale of LOCALES) {
      const seen = new Map<string, string>()
      for (const type of MBTI_TYPES) {
        const key = getCareerContent(locale, type).roles.join('|')
        expect(seen.has(key), `${locale}: ${type} has the same roles as ${seen.get(key)}`).toBe(
          false
        )
        seen.set(key, type)
      }
    }
  })

  it('keeps overlap between any two types low', () => {
    // Some overlap is honest - ENTJ and ESTJ really do both suit operations management.
    // Wholesale overlap is not, so cap any pair at half a list in common.
    for (const locale of LOCALES) {
      for (const a of MBTI_TYPES) {
        for (const b of MBTI_TYPES) {
          if (a >= b) continue
          const rolesA = new Set(getCareerContent(locale, a).roles)
          const rolesB = getCareerContent(locale, b).roles
          const shared = rolesB.filter(role => rolesA.has(role)).length
          const cap = Math.floor(Math.min(rolesA.size, rolesB.length) / 2)
          expect(shared, `${locale}: ${a} and ${b} share ${shared} roles`).toBeLessThanOrEqual(cap)
        }
      }
    }
  })

  it('never repeats a workStyle sentence between two types', () => {
    for (const locale of LOCALES) {
      const seen = new Set<string>()
      for (const type of MBTI_TYPES) {
        const style = getCareerContent(locale, type).workStyle
        expect(seen.has(style), `${locale} ${type} duplicates another workStyle`).toBe(false)
        seen.add(style)
      }
    }
  })

  it('gives each locale its own list rather than a translation of the other', () => {
    // The Vietnamese roles lean toward the Vietnamese job market. If the two files ever
    // become identical strings, one of them has been pasted over the other.
    for (const type of MBTI_TYPES) {
      expect(getCareerContent('vi', type).roles).not.toEqual(getCareerContent('en', type).roles)
    }
  })

  it('describes what drains a type differently from what suits it', () => {
    // Both fields exist to say different things; a copy-paste between them is a real
    // authoring slip that reads as nonsense.
    for (const locale of LOCALES) {
      for (const type of MBTI_TYPES) {
        const careers = getCareerContent(locale, type)
        expect(careers.thrivesIn, `${locale} ${type}`).not.toBe(careers.drainedBy)
      }
    }
  })
})
