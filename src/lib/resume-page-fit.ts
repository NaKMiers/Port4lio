import type { LocatedResumeItem } from '@/lib/resume-view-model'
import { locateResumeItems, planResumeSheets } from '@/lib/resume-view-model'
import type { Resume, ResumePageBreak } from '@/types/profile'

/**
 * A break the {@link ResumePageBreak} model can actually express, plus where sheet 1 would
 * end if it were chosen - measured, in pixels from the top of the sheet.
 */
type Candidate = ResumePageBreak & { bottom: number }

/**
 * Picks the page break that fills sheet 1 without spilling past it.
 *
 * Reordering sections or projects changes how much copy sits above the break, and the break
 * itself is a coordinate into a project rather than a height - so any rule that moves it by
 * index is guessing. This measures instead: `sheet` is a `CvFlowSheet` holding every block at
 * true A4 width with no height cap, `limitPx` is one page, and the answer is the lowest
 * expressible cut that still lands above the limit.
 *
 * "Expressible" is the constraint that shapes this. `planResumeSheets` can only cut inside a
 * bullet list, so the candidates are exactly: before each `highlights` block (0 lines kept),
 * and after each of its lines. A break between, say, a project head and its details cannot
 * be written down, so the fitter steps back to the last bullet boundary that fits.
 *
 * Returns `null` when the resume has no bullet list to cut in and nothing to decide.
 */
type SheetGeometry = {
  /** One element per located item, in order. */
  blocks: HTMLElement[]
  /** Distance from the top of the sheet to an element's bottom edge. */
  bottomOf: (element: Element) => number
}

/** `CvFlowSheet` renders the masthead first, then exactly one element per located item. */
function readSheet(sheet: HTMLElement): SheetGeometry {
  const sheetTop = sheet.getBoundingClientRect().top
  return {
    blocks: (Array.from(sheet.children) as HTMLElement[]).slice(1),
    bottomOf: element => element.getBoundingClientRect().bottom - sheetTop,
  }
}

/**
 * Whether the break a resume currently carries spills past the bottom of sheet 1.
 *
 * Asked before re-fitting on open, so a break that already fits is never overwritten - a
 * deliberately early cut, say, to keep a project whole. A break that clips is broken by
 * definition, so replacing it cannot destroy an intention.
 *
 * The cut point comes from `planResumeSheets` rather than being re-derived here: sheet 1
 * holds located items `0 .. first.length - 1`, and a trailing `highlights` block carrying
 * fewer lines than its source is the one that got split.
 */
export function resumeBreakOverflows(
  sheet: HTMLElement,
  limitPx: number,
  resume: Resume
): boolean {
  const { blocks, bottomOf } = readSheet(sheet)
  const located = locateResumeItems(resume)
  const first = planResumeSheets(resume).first
  if (first.length === 0) return false

  const index = first.length - 1
  const block = blocks[index]
  if (!block) return false

  const last = first[index]
  const source = located[index]?.item

  if (last.kind === 'highlights' && source?.kind === 'highlights') {
    const kept = last.lines.length
    if (kept < source.lines.length) {
      const line = block.children[kept - 1]
      return line ? bottomOf(line) > limitPx : false
    }
  }

  return bottomOf(block) > limitPx
}

export function fitResumePageBreak(
  sheet: HTMLElement,
  limitPx: number,
  located: LocatedResumeItem[]
): ResumePageBreak | null {
  const { blocks, bottomOf } = readSheet(sheet)
  if (blocks.length === 0) return null

  // Nothing overflows: keep the whole CV on sheet 1 by addressing a section that does not
  // exist, which `planResumeSheets` clamps to "cut past the end".
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock && bottomOf(lastBlock) <= limitPx) {
    const sections = located.reduce(
      (max, entry) => Math.max(max, entry.sectionIndex + 1),
      0
    )
    return {
      sectionIndex: sections,
      projectIndex: 0,
      highlightsOnFirstSheet: 0,
    }
  }

  const candidates: Candidate[] = []

  located.forEach((entry, index) => {
    if (entry.item.kind !== 'highlights') return
    const element = blocks[index]
    if (!element) return

    const at = {
      sectionIndex: entry.sectionIndex,
      projectIndex: entry.projectIndex,
    }

    // Keeping no lines moves the whole bullet list down, so sheet 1 ends at the block above.
    const previous = blocks[index - 1]
    candidates.push({
      ...at,
      highlightsOnFirstSheet: 0,
      bottom: previous ? bottomOf(previous) : 0,
    })

    Array.from(element.children).forEach((line, lineIndex) => {
      candidates.push({
        ...at,
        highlightsOnFirstSheet: lineIndex + 1,
        bottom: bottomOf(line),
      })
    })
  })

  if (candidates.length === 0) return null

  // Candidates are already in stream order, so the last one that fits is the fullest page.
  let best: Candidate | undefined
  for (const candidate of candidates)
    if (candidate.bottom <= limitPx) best = candidate

  // Even the earliest cut overflows - the copy above the first bullet list is already taller
  // than a page. Take that earliest cut anyway: it is the least bad, and the editor's
  // overflow banner still says the sheet is being clipped.
  const chosen = best ?? candidates[0]

  return {
    sectionIndex: chosen.sectionIndex,
    projectIndex: chosen.projectIndex,
    highlightsOnFirstSheet: chosen.highlightsOnFirstSheet,
  }
}
