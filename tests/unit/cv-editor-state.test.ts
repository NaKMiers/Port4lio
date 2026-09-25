import { describe, expect, it } from 'vitest'

import {
  autoFitted,
  created,
  cvActionGates,
  deepEqual,
  deleted,
  editDraft,
  initialCvEditorState,
  isDirty,
  loaded,
  markStale,
  published,
  renamed,
  saved,
  selected,
  type CvEditorState,
} from '@/components/settings/cv-editor-state'
import { makeEmptyResume } from '@/lib/profile'
import type { CvDto } from '@/types/cv'

/**
 * The CV tab's pure state (multi-cv-plan.md D4, D9, OV-1, OV-5, OV-6).
 *
 * ```
 *   select      the picked CV's SAVED resume becomes draft and snapshot
 *   dirty       draft deep-differs from snapshot - an undone edit is clean again   (D9)
 *   auto-fit    a moved break dirties the CV and raises the notice                 (D9)
 *   discard     re-selecting the CV drops the draft                                (D4)
 *   delete      the published CV is selected afterwards
 *   upload lock picker, New, Delete, Publish off while the CV photo uploads       (OV-6)
 * ```
 */

const cv = (
  id: string,
  name: string,
  updatedAt = '2026-09-25T10:00:00.000Z'
): CvDto => ({
  id,
  label: `CV ${id}`,
  resume: { ...makeEmptyResume(), name },
  publishedAt: null,
  updatedAt,
})

const LIST = {
  cvs: [cv('a', 'Alpha'), cv('b', 'Bravo'), cv('c', 'Charlie')],
  publishedId: 'b',
}

const ready = (): CvEditorState => loaded(initialCvEditorState(), LIST)
const rename = (state: CvEditorState, name: string) =>
  editDraft(state, draft => ({ ...draft, name }))
const gates = (
  state: CvEditorState,
  { busy = false, uploadingCvPhoto = false } = {}
) => cvActionGates(state, { busy, uploadingCvPhoto })

describe('loaded', () => {
  it('opens the published CV first, clean, with its updatedAt as the base', () => {
    const state = ready()
    expect(state.status).toBe('ready')
    expect(state.selectedId).toBe('b')
    expect(state.draft?.name).toBe('Bravo')
    expect(state.base).toBe('2026-09-25T10:00:00.000Z')
    expect(isDirty(state)).toBe(false)
  })

  it("the stale banner's Reload keeps the CV and resets the draft to the server copy (OV-5)", () => {
    const edited = markStale(rename(selected(ready(), 'c'), 'Mine'))
    const server = {
      ...LIST,
      cvs: [
        LIST.cvs[0],
        LIST.cvs[1],
        cv('c', 'Theirs', '2026-09-25T11:00:00.000Z'),
      ],
    }

    const reloaded = loaded(edited, server)

    expect(reloaded.selectedId).toBe('c')
    expect(reloaded.draft?.name).toBe('Theirs')
    expect(reloaded.base).toBe('2026-09-25T11:00:00.000Z')
    expect(reloaded.stale).toBe(false)
    expect(isDirty(reloaded)).toBe(false)
  })

  it('falls back to the published CV when the preferred one is gone', () => {
    expect(loaded(initialCvEditorState(), LIST, 'gone').selectedId).toBe('b')
  })
})

describe('select and dirty (D4, D9)', () => {
  it('selecting opens that CV from its saved copy', () => {
    const state = selected(ready(), 'a')
    expect(state.selectedId).toBe('a')
    expect(state.draft?.name).toBe('Alpha')
    expect(isDirty(state)).toBe(false)
  })

  it('an edit is dirty; undoing it by hand is clean again - snapshot compare, not a flag', () => {
    const edited = rename(ready(), 'Changed')
    expect(isDirty(edited)).toBe(true)
    expect(isDirty(rename(edited, 'Bravo'))).toBe(false)
  })

  it('re-selecting the same CV is the discard: the draft goes back to the saved copy', () => {
    const discarded = selected(rename(ready(), 'Changed'), 'b')
    expect(discarded.draft?.name).toBe('Bravo')
    expect(isDirty(discarded)).toBe(false)
  })

  it('deepEqual ignores key order', () => {
    expect(
      deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })
    ).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
  })
})

describe('auto-fit notice (D9)', () => {
  it('a moved break dirties the CV and raises the notice', () => {
    const state = autoFitted(ready(), {
      sectionIndex: 1,
      projectIndex: 2,
      highlightsOnFirstSheet: 0,
    })
    expect(state.refitted).toBe(true)
    expect(isDirty(state)).toBe(true)
    expect(state.draft?.pageBreak.projectIndex).toBe(2)
  })

  it('an unchanged break is a no-op, notice off', () => {
    const start = ready()
    const state = autoFitted(start, start.draft!.pageBreak)
    expect(state).toBe(start)
    expect(state.refitted).toBe(false)
  })

  it('saving or switching clears the notice', () => {
    const fitted = autoFitted(ready(), {
      sectionIndex: 1,
      projectIndex: 2,
      highlightsOnFirstSheet: 0,
    })
    expect(selected(fitted, 'a').refitted).toBe(false)
    expect(
      saved(fitted, { ...LIST.cvs[1], resume: fitted.draft! }).refitted
    ).toBe(false)
  })
})

describe('writes', () => {
  it('saved: the server copy becomes draft, snapshot and base', () => {
    const edited = markStale(rename(ready(), 'Changed'))
    const server = cv('b', 'Changed', '2026-09-25T12:00:00.000Z')

    const state = saved(edited, server)

    expect(isDirty(state)).toBe(false)
    expect(state.base).toBe('2026-09-25T12:00:00.000Z')
    expect(state.stale).toBe(false)
    expect(state.cvs[1].resume.name).toBe('Changed')
  })

  it('saved: edits typed while the save was in flight are kept, and stay dirty', () => {
    const sent = rename(ready(), 'Sent').draft!
    const typedSince = rename(
      { ...ready(), draft: sent },
      'Sent, then more typing'
    )
    const server = {
      ...cv('b', 'Sent', '2026-09-25T12:00:00.000Z'),
      resume: { ...sent },
    }

    const state = saved(typedSince, server, sent)

    expect(state.draft?.name).toBe('Sent, then more typing')
    expect(state.snapshot?.name).toBe('Sent')
    expect(state.base).toBe('2026-09-25T12:00:00.000Z')
    expect(isDirty(state)).toBe(true)
    // Nothing typed since: the server copy replaces the draft, as before.
    expect(saved({ ...ready(), draft: sent }, server, sent).draft).toBe(
      server.resume
    )
  })

  it('renamed: label and base move, the dirty draft is left alone (OV-1)', () => {
    const edited = rename(ready(), 'Unsaved')
    const state = renamed(edited, {
      ...LIST.cvs[1],
      label: 'Backend',
      updatedAt: '2026-09-25T13:00:00.000Z',
    })

    expect(state.cvs[1].label).toBe('Backend')
    expect(state.base).toBe('2026-09-25T13:00:00.000Z')
    expect(state.draft?.name).toBe('Unsaved')
    expect(isDirty(state)).toBe(true)
  })

  it('created: the new CV is appended and selected', () => {
    const state = created(ready(), cv('d', 'Delta'))
    expect(state.cvs.map(item => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(state.selectedId).toBe('d')
    expect(state.draft?.name).toBe('Delta')
  })

  it('deleted: the published CV is selected afterwards', () => {
    const state = deleted(selected(ready(), 'c'), 'c')
    expect(state.cvs.map(item => item.id)).toEqual(['a', 'b'])
    expect(state.selectedId).toBe('b')
    expect(state.draft?.name).toBe('Bravo')
  })

  it('deleting another CV keeps the selection and its draft', () => {
    const edited = rename(selected(ready(), 'a'), 'Mine')
    const state = deleted(edited, 'c')
    expect(state.selectedId).toBe('a')
    expect(state.draft?.name).toBe('Mine')
  })

  it('published: publishedId moves', () => {
    expect(published(ready(), 'c').publishedId).toBe('c')
  })
})

describe('action gates', () => {
  it('the published CV cannot be deleted or re-published', () => {
    const g = gates(ready())
    expect(g.canDelete).toBe(false)
    expect(g.deleteTitle).toMatch(/Publish another CV first/)
    expect(g.canPublish).toBe(false)
  })

  it('another CV can be deleted and published - but not published while dirty', () => {
    const other = selected(ready(), 'a')
    expect(gates(other).canDelete).toBe(true)
    expect(gates(other).canPublish).toBe(true)

    const dirty = gates(rename(other, 'Changed'))
    expect(dirty.canPublish).toBe(false)
    expect(dirty.publishTitle).toMatch(/Save first/)
    expect(dirty.canSave).toBe(true)
  })

  it('a CV photo upload locks the picker, New, Delete and Publish, and Save CV (OV-6)', () => {
    const g = gates(selected(ready(), 'a'), { uploadingCvPhoto: true })
    expect(g.locked).toBe(true)
    expect(g.canSelect).toBe(false)
    expect(g.canCreate).toBe(false)
    expect(g.canDelete).toBe(false)
    expect(g.canPublish).toBe(false)
    expect(g.canSave).toBe(false)
  })

  it('a request in flight disables everything; nothing works before the list loads', () => {
    const busy = gates(ready(), { busy: true })
    expect(busy.canSave).toBe(false)
    expect(busy.canSelect).toBe(false)
    expect(busy.canRename).toBe(false)

    const empty = gates(initialCvEditorState())
    expect(empty.canSave).toBe(false)
    expect(empty.canCreate).toBe(false)
  })
})
