import { describe, expect, it } from 'vitest'

import { normalizeResume } from '@/lib/profile'
import { RESUME_SEED } from '@/lib/resume-seed'
import {
  DEFAULT_RESUME_SECTION_ORDER,
  moveItem,
  normalizeResumeSectionOrder,
} from '@/lib/resume-sections'
import { flattenResume, planResumeSheets } from '@/lib/resume-view-model'
import type { Resume, ResumeSectionKey } from '@/types/profile'

/** `kind` plus, for a section rule, the gap class it chose - the two things order changes. */
function shape(resume: Resume): string[] {
  return flattenResume(resume).map(item =>
    item.kind === 'sectionHeading' ? `heading:${item.gap}` : item.kind
  )
}

function reordered(order: ResumeSectionKey[]): Resume {
  return { ...RESUME_SEED, sectionOrder: order }
}

describe('normalizeResumeSectionOrder', () => {
  it('fills in an absent order with the default', () => {
    expect(normalizeResumeSectionOrder(undefined)).toEqual(
      DEFAULT_RESUME_SECTION_ORDER
    )
  })

  it('drops unknown and duplicate keys, then appends whatever is missing', () => {
    expect(
      normalizeResumeSectionOrder(['projects', 'nope', 'projects', 'summary'])
    ).toEqual(['projects', 'summary', 'education', 'skills', 'certifications'])
  })

  it('survives a stored value that is not an array', () => {
    expect(normalizeResumeSectionOrder('summary')).toEqual(
      DEFAULT_RESUME_SECTION_ORDER
    )
    expect(normalizeResume({ sectionOrder: 42 }).sectionOrder).toEqual(
      DEFAULT_RESUME_SECTION_ORDER
    )
  })
})

describe('moveItem', () => {
  it('moves an entry down and up', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('returns the list untouched for a no-op or an out-of-range index', () => {
    const list = ['a', 'b']
    expect(moveItem(list, 1, 1)).toBe(list)
    expect(moveItem(list, 0, 9)).toBe(list)
  })
})

describe('flattenResume', () => {
  it('prints the default order with the source document gaps', () => {
    // The layout as it was hardcoded in `CvSheets`: the first rule clears the masthead,
    // rules after body copy use gHead, rules after a skill row use the tighter gHeadS.
    expect(shape(RESUME_SEED).slice(0, 12)).toEqual([
      'heading:gFirst', // SUMMARY
      'text',
      'heading:gHead', // EDUCATION
      'text',
      'heading:gHead', // first skill block
      'skillRows',
      'heading:gHeadS', // later skill blocks sit tighter
      'skillRows',
      'heading:gHeadS',
      'skillRows',
      'heading:gHeadS', // CERTIFICATIONS
      'certifications',
    ])
  })

  it('re-derives the gaps when sections move', () => {
    const shaped = shape(
      reordered([
        'certifications',
        'skills',
        'summary',
        'education',
        'projects',
      ])
    )

    expect(shaped.slice(0, 4)).toEqual([
      'heading:gFirst', // CERTIFICATIONS now clears the masthead
      'certifications',
      'heading:gHead', // first skill block follows body copy
      'skillRows',
    ])
    // SUMMARY follows a skill row, so it takes the tighter rule gap.
    expect(shaped[shaped.indexOf('skillRows') + 1]).toBe('heading:gHeadS')
  })

  it('emits every section exactly once whatever the stored order says', () => {
    const junk = reordered(['projects', 'projects'] as ResumeSectionKey[])
    expect(shape(junk).filter(kind => kind === 'certifications')).toHaveLength(
      1
    )
    expect(
      shape(junk).filter(kind => kind === 'skillRows').length
    ).toBeGreaterThan(0)
  })
})

describe('planResumeSheets', () => {
  it('splits the seed at its stored page break, mid bullet list', () => {
    const { first, second } = planResumeSheets(RESUME_SEED)
    const { highlightsOnFirstSheet } = RESUME_SEED.pageBreak

    expect(first[first.length - 1]).toEqual({
      kind: 'highlights',
      lines: expect.any(Array),
    })
    expect((first[first.length - 1] as { lines: string[] }).lines).toHaveLength(
      highlightsOnFirstSheet
    )
    expect(second[0].kind).toBe('highlights')
  })

  it('pushes sections ordered after projects onto sheet 2', () => {
    const { first, second } = planResumeSheets(
      reordered([
        'summary',
        'education',
        'skills',
        'projects',
        'certifications',
      ])
    )

    expect(first.some(item => item.kind === 'certifications')).toBe(false)
    expect(second.some(item => item.kind === 'certifications')).toBe(true)
  })

  it('keeps everything on sheet 1 when the break coordinate addresses nothing', () => {
    const resume: Resume = {
      ...RESUME_SEED,
      pageBreak: {
        sectionIndex: 99,
        projectIndex: 0,
        highlightsOnFirstSheet: 0,
      },
    }
    expect(planResumeSheets(resume).second).toHaveLength(0)
  })
})
