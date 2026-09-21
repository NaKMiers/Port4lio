import { describe, expect, it } from 'vitest'

import { fitResumePageBreak, resumeBreakOverflows } from '@/lib/resume-page-fit'
import { RESUME_SEED } from '@/lib/resume-seed'
import type { LocatedResumeItem } from '@/lib/resume-view-model'
import { locateResumeItems, planResumeSheets } from '@/lib/resume-view-model'
import type { Resume } from '@/types/profile'

/** One measured block: where its bottom edge sits, and its bullet lines if it has any. */
type BlockSpec = { bottom: number; lines?: number[] }

/**
 * A stand-in for a rendered `CvFlowSheet`.
 *
 * The fitter only ever reads `children` and `getBoundingClientRect().bottom`, so a plain
 * object with those is enough to drive the whole decision without a DOM.
 */
function fakeSheet(blocks: BlockSpec[]): HTMLElement {
  const element = (bottom: number, lines: number[] = []): HTMLElement =>
    ({
      getBoundingClientRect: () => ({ bottom }),
      children: lines.map(lineBottom => element(lineBottom)),
    }) as unknown as HTMLElement

  return {
    getBoundingClientRect: () => ({ top: 0 }),
    // The masthead is children[0]; located items start at children[1].
    children: [
      element(100),
      ...blocks.map(block => element(block.bottom, block.lines)),
    ],
  } as unknown as HTMLElement
}

function located(
  kinds: ('projectHead' | 'highlights' | 'text')[]
): LocatedResumeItem[] {
  return kinds.map((kind, index) => ({
    item:
      kind === 'highlights'
        ? { kind, lines: [] }
        : kind === 'text'
          ? { kind, lines: [], justify: false }
          : { kind, employer: '', title: '', period: '', gap: 'gBody' },
    sectionIndex: 0,
    projectIndex: index,
  }))
}

const LIMIT = 1000

describe('fitResumePageBreak', () => {
  it('cuts at the last bullet that still fits on the page', () => {
    const sheet = fakeSheet([
      { bottom: 300 },
      { bottom: 980, lines: [850, 920, 980, 1040] },
      { bottom: 1200 },
    ])

    expect(
      fitResumePageBreak(
        sheet,
        LIMIT,
        located(['projectHead', 'highlights', 'text'])
      )
    ).toEqual({ sectionIndex: 0, projectIndex: 1, highlightsOnFirstSheet: 3 })
  })

  it('moves a whole bullet list down when not one of its lines fits', () => {
    const sheet = fakeSheet([
      { bottom: 900 },
      { bottom: 1400, lines: [1100, 1250, 1400] },
      { bottom: 1600 },
    ])

    // Keeping zero lines ends sheet 1 at the block above, which is the only cut that fits.
    expect(
      fitResumePageBreak(
        sheet,
        LIMIT,
        located(['projectHead', 'highlights', 'text'])
      )
    ).toEqual({ sectionIndex: 0, projectIndex: 1, highlightsOnFirstSheet: 0 })
  })

  it('steps back past a block it cannot cut inside', () => {
    // The overflow lands in the trailing text block, which the break model cannot address,
    // so the fitter falls back to the last bullet boundary above it.
    const sheet = fakeSheet([
      { bottom: 300 },
      { bottom: 700, lines: [600, 650, 700] },
      { bottom: 1300 },
    ])

    expect(
      fitResumePageBreak(
        sheet,
        LIMIT,
        located(['projectHead', 'highlights', 'text'])
      )
    ).toEqual({ sectionIndex: 0, projectIndex: 1, highlightsOnFirstSheet: 3 })
  })

  it('keeps the whole CV on sheet 1 when nothing overflows', () => {
    const sheet = fakeSheet([
      { bottom: 300 },
      { bottom: 600, lines: [500, 600] },
      { bottom: 800 },
    ])
    const result = fitResumePageBreak(
      sheet,
      LIMIT,
      located(['projectHead', 'highlights', 'text'])
    )

    // An out-of-range section is how `planResumeSheets` is told to cut past the end.
    expect(result).toEqual({
      sectionIndex: 1,
      projectIndex: 0,
      highlightsOnFirstSheet: 0,
    })
  })

  it('takes the earliest cut when even that one overflows', () => {
    const sheet = fakeSheet([
      { bottom: 1500 },
      { bottom: 2000, lines: [1800, 2000] },
    ])

    expect(
      fitResumePageBreak(sheet, LIMIT, located(['projectHead', 'highlights']))
    ).toEqual({
      sectionIndex: 0,
      projectIndex: 1,
      highlightsOnFirstSheet: 0,
    })
  })

  it('declines to decide when there is no bullet list to cut in', () => {
    const sheet = fakeSheet([{ bottom: 900 }, { bottom: 1400 }])
    expect(
      fitResumePageBreak(sheet, LIMIT, located(['projectHead', 'text']))
    ).toBeNull()
  })

  it('declines to decide on an empty sheet', () => {
    expect(fitResumePageBreak(fakeSheet([]), LIMIT, [])).toBeNull()
  })
})

describe('resumeBreakOverflows', () => {
  /**
   * Every block 100 tall. Bullet blocks get one line element each, stacked just above the
   * block's own bottom - the real DOM always has them, and the split path reads them.
   */
  function seedSheet(
    resume: Resume,
    lineBottoms: Record<number, number[]> = {}
  ) {
    return fakeSheet(
      locateResumeItems(resume).map((entry, index) => {
        const bottom = (index + 1) * 100
        if (lineBottoms[index]) return { bottom, lines: lineBottoms[index] }
        if (entry.item.kind !== 'highlights') return { bottom }
        const count = entry.item.lines.length
        return {
          bottom,
          lines: entry.item.lines.map((_, i) => bottom - (count - 1 - i)),
        }
      })
    )
  }

  const breakAt = locateResumeItems(RESUME_SEED).findIndex(
    entry =>
      entry.sectionIndex === 0 &&
      entry.projectIndex === 0 &&
      entry.item.kind === 'highlights'
  )

  it('reports a page that fits', () => {
    expect(
      resumeBreakOverflows(seedSheet(RESUME_SEED), 1_000_000, RESUME_SEED)
    ).toBe(false)
  })

  it('reports a page that spills', () => {
    expect(resumeBreakOverflows(seedSheet(RESUME_SEED), 1, RESUME_SEED)).toBe(
      true
    )
  })

  it('measures the kept lines, not the whole bullet list, when the break splits one', () => {
    // The seed keeps 2 of this project's 6 bullets on sheet 1. Lines run past the limit,
    // but the second one - the last that actually prints on sheet 1 - lands under it.
    const blockBottom = (breakAt + 1) * 100
    const lines = [
      blockBottom - 50,
      blockBottom - 40,
      blockBottom - 30,
      blockBottom - 20,
      blockBottom - 10,
      blockBottom,
    ]
    const sheet = seedSheet(RESUME_SEED, { [breakAt]: lines })

    expect(planResumeSheets(RESUME_SEED).first.length - 1).toBe(breakAt)
    expect(resumeBreakOverflows(sheet, blockBottom - 35, RESUME_SEED)).toBe(
      false
    )
    expect(resumeBreakOverflows(sheet, blockBottom - 45, RESUME_SEED)).toBe(
      true
    )
  })

  it('falls back to the whole block when the break keeps every line', () => {
    const resume: Resume = {
      ...RESUME_SEED,
      pageBreak: { ...RESUME_SEED.pageBreak, highlightsOnFirstSheet: 99 },
    }
    const blockBottom = (breakAt + 1) * 100
    const sheet = seedSheet(resume, {
      [breakAt]: [blockBottom - 10, blockBottom],
    })

    expect(resumeBreakOverflows(sheet, blockBottom - 5, resume)).toBe(true)
    expect(resumeBreakOverflows(sheet, blockBottom + 5, resume)).toBe(false)
  })
})
