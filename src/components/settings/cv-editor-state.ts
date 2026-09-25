import type { CvDto, CvListDto } from '@/types/cv'
import type { Resume, ResumePageBreak } from '@/types/profile'

/**
 * The settings CV tab's state, as pure transitions so they unit-test without React
 * (multi-cv-plan.md, "Settings UI"). `useCvEditor` holds one of these and wires the fetches.
 *
 * ```
 *   loaded(list, preferId)   select preferId, else the current CV, else the published one
 *                            draft = snapshot = that CV's saved resume, base = its updatedAt
 *   editDraft(update)        draft only - the snapshot is what the server has
 *   autoFitted(pageBreak)    the on-open fit moved the break: draft changes, notice on (D9)
 *   selected(id)             another CV: draft reset to ITS saved copy (the caller confirms
 *                            discarding a dirty draft first, D4)
 *   saved(cv, sent)          draft = snapshot = the server's copy, new base, stale off;
 *                            edits typed while the save was in flight stay in the draft
 *   renamed(cv)              label + base only; the draft is left alone (OV-1)
 *   created(cv)              appended and selected
 *   deleted(id)              removed; the published CV is selected
 *   published(id)            publishedId moves
 *   orphaned()               Save CV got a 404: the CV was deleted, maybe by an agent (P2-D).
 *                            The draft stays; only Save as new CV (or discarding) moves on
 *   rescued(cv, sent)        Save as new CV: the deleted CV leaves the list, `cv` is selected
 *
 *   dirty = draft deep-differs from snapshot, or orphaned  (D9: not "any setResume happened")
 *   needsFitCheck = the selected CV has fitVerified false  (an agent wrote it, P2-A)
 * ```
 *
 * One draft at a time, for the selected CV only (D4). `snapshot` is what makes `dirty`
 * honest: an edit that is typed and then undone is not unsaved work, and the auto-fit
 * repairing a clipped page genuinely is.
 *
 * An orphaned draft counts as dirty even when it equals its snapshot: the server copy is
 * gone, so the draft is the only copy left, and every action that would drop it must go
 * through the discard confirm first.
 */

export type CvEditorState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  cvs: CvDto[]
  publishedId: string | null
  selectedId: string | null
  /** What the cards edit and the preview renders. */
  draft: Resume | null
  /** The selected CV as last saved (or loaded). */
  snapshot: Resume | null
  /** The selected CV's `updatedAt`: Save CV's stale-tab guard. */
  base: string | null
  /** Save CV was refused because another tab saved this CV first. */
  stale: boolean
  /** The on-open fit moved the page break since the CV was selected or saved. */
  refitted: boolean
  /** Save CV found the selected CV deleted (by an agent, or another tab): P2-D. */
  orphaned: boolean
}

export function initialCvEditorState(): CvEditorState {
  return {
    status: 'idle',
    error: null,
    cvs: [],
    publishedId: null,
    selectedId: null,
    draft: null,
    snapshot: null,
    base: null,
    stale: false,
    refitted: false,
    orphaned: false,
  }
}

/** Structural equality for plain JSON data - key order does not matter. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return (
      a.length === other.length && a.every((v, i) => deepEqual(v, other[i]))
    )
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every(key => key in right && deepEqual(left[key], right[key]))
  )
}

export function isDirty(state: CvEditorState): boolean {
  return (
    !!state.draft && (state.orphaned || !deepEqual(state.draft, state.snapshot))
  )
}

export function selectedCv(state: CvEditorState): CvDto | null {
  return state.cvs.find(cv => cv.id === state.selectedId) ?? null
}

/**
 * The selected CV was last written by an agent, so nothing has measured its page fit yet
 * (P2-A). The editor's on-open fit runs regardless; the owner's Save CV clears this.
 */
export function needsFitCheck(state: CvEditorState): boolean {
  return !state.orphaned && selectedCv(state)?.fitVerified === false
}

/** Opens `cv` fresh: its saved resume becomes both the draft and the snapshot. */
function open(state: CvEditorState, cv: CvDto | null): CvEditorState {
  return {
    ...state,
    selectedId: cv?.id ?? null,
    draft: cv?.resume ?? null,
    snapshot: cv?.resume ?? null,
    base: cv?.updatedAt ?? null,
    stale: false,
    refitted: false,
    orphaned: false,
  }
}

export function loading(state: CvEditorState): CvEditorState {
  return { ...state, status: 'loading', error: null }
}

export function failed(state: CvEditorState, error: string): CvEditorState {
  return { ...state, status: 'error', error }
}

/**
 * A fresh list from the server. Used on first load and by the stale banner's Reload, which
 * must reset the draft to the server copy (OV-5) - so this always re-opens.
 */
export function loaded(
  state: CvEditorState,
  list: CvListDto,
  preferId: string | null = state.selectedId
): CvEditorState {
  const pick =
    list.cvs.find(cv => cv.id === preferId) ??
    list.cvs.find(cv => cv.id === list.publishedId) ??
    list.cvs[0] ??
    null
  return open(
    {
      ...state,
      status: 'ready',
      error: null,
      cvs: list.cvs,
      publishedId: list.publishedId,
    },
    pick
  )
}

export function selected(state: CvEditorState, id: string): CvEditorState {
  const cv = state.cvs.find(item => item.id === id)
  if (!cv) return state
  // Leaving an orphaned CV discards its draft, and the CV itself no longer exists.
  const cvs = state.orphaned
    ? state.cvs.filter(item => item.id !== state.selectedId)
    : state.cvs
  return open({ ...state, cvs }, cv)
}

export function editDraft(
  state: CvEditorState,
  update: Resume | ((draft: Resume) => Resume)
): CvEditorState {
  if (!state.draft) return state
  const draft = typeof update === 'function' ? update(state.draft) : update
  return draft === state.draft ? state : { ...state, draft }
}

/** The on-open fit (`onlyIfClipped`) moved the break. A real change, so the notice shows. */
export function autoFitted(
  state: CvEditorState,
  pageBreak: ResumePageBreak
): CvEditorState {
  if (!state.draft || deepEqual(state.draft.pageBreak, pageBreak)) return state
  return {
    ...state,
    draft: { ...state.draft, pageBreak },
    refitted: true,
  }
}

function replaced(cvs: CvDto[], cv: CvDto): CvDto[] {
  return cvs.map(item => (item.id === cv.id ? cv : item))
}

/**
 * Save CV succeeded. `sent` is the draft the request carried: if the owner kept typing while
 * it was in flight, the draft is no longer that object, and those edits are kept - only the
 * snapshot and base move to the server copy, so the CV correctly stays dirty.
 */
export function saved(
  state: CvEditorState,
  cv: CvDto,
  sent?: Resume
): CvEditorState {
  const next = { ...state, cvs: replaced(state.cvs, cv) }
  const editedSince =
    sent !== undefined && state.selectedId === cv.id && state.draft !== sent
  if (!editedSince) return open(next, cv)
  return {
    ...next,
    snapshot: cv.resume,
    base: cv.updatedAt,
    stale: false,
  }
}

/** A rename bumps `updatedAt`; the base follows it, the draft is left exactly as it was. */
export function renamed(state: CvEditorState, cv: CvDto): CvEditorState {
  return {
    ...state,
    cvs: state.cvs.map(item =>
      item.id === cv.id
        ? { ...item, label: cv.label, updatedAt: cv.updatedAt }
        : item
    ),
    base: state.selectedId === cv.id ? cv.updatedAt : state.base,
  }
}

export function created(state: CvEditorState, cv: CvDto): CvEditorState {
  return open({ ...state, cvs: [...state.cvs, cv] }, cv)
}

export function deleted(state: CvEditorState, id: string): CvEditorState {
  const cvs = state.cvs.filter(cv => cv.id !== id)
  const next = { ...state, cvs }
  if (state.selectedId !== id) return next
  return open(
    next,
    cvs.find(cv => cv.id === state.publishedId) ?? cvs[0] ?? null
  )
}

export function published(state: CvEditorState, id: string): CvEditorState {
  return { ...state, publishedId: id }
}

export function markStale(state: CvEditorState): CvEditorState {
  return { ...state, stale: true }
}

/** Save CV answered 404. The draft is kept - it is now the only copy of this CV (P2-D). */
export function orphaned(state: CvEditorState): CvEditorState {
  return { ...state, orphaned: true, stale: false }
}

/**
 * Save as new CV succeeded: the deleted CV leaves the list and the new one is selected. As
 * in `saved`, edits typed while the request was in flight stay in the draft.
 */
export function rescued(
  state: CvEditorState,
  cv: CvDto,
  sent?: Resume
): CvEditorState {
  const next = {
    ...state,
    cvs: [...state.cvs.filter(item => item.id !== state.selectedId), cv],
  }
  const editedSince = sent !== undefined && state.draft !== sent
  if (!editedSince) return open(next, cv)
  return {
    ...open(next, cv),
    draft: state.draft,
  }
}

export type CvActionGates = {
  /** Picker, New, Delete and Publish: off while a CV photo uploads (OV-6). */
  locked: boolean
  canSelect: boolean
  canCreate: boolean
  canRename: boolean
  canDelete: boolean
  /** Why Delete is off, for its `title`. */
  deleteTitle: string | undefined
  canPublish: boolean
  publishTitle: string | undefined
  /** Save CV gates on its own save and the CV photo upload only (OV-6). */
  canSave: boolean
  saveTitle: string | undefined
  /** Save as new CV, the one way forward for an orphaned draft (P2-D). */
  canSaveAsNew: boolean
}

/**
 * Which CV actions are available. `busy` is a CV request in flight (save, publish, delete,
 * create, rename); `uploadingCvPhoto` is the masthead photo upload, the one upload that
 * writes into the draft - finishing after a switch would land it in another CV.
 */
export function cvActionGates(
  state: CvEditorState,
  { busy, uploadingCvPhoto }: { busy: boolean; uploadingCvPhoto: boolean }
): CvActionGates {
  const ready = state.status === 'ready' && !!state.selectedId
  const isPublished =
    !!state.selectedId && state.selectedId === state.publishedId
  const dirty = isDirty(state)
  const locked = uploadingCvPhoto
  const open = ready && !busy && !locked
  // The selected CV is gone: only Save as new CV, or leaving it, still makes sense.
  const gone = state.orphaned
  const goneTitle = 'This CV was deleted - use Save as new CV'

  return {
    locked,
    canSelect: open && state.cvs.length > 1,
    canCreate: open && !gone,
    canRename: ready && !busy && !gone,
    canDelete: open && !isPublished && !gone,
    deleteTitle: gone
      ? goneTitle
      : isPublished
        ? 'This is the published CV. Publish another CV first.'
        : locked
          ? 'Waiting for the CV photo upload to finish'
          : undefined,
    canPublish: open && !isPublished && !dirty,
    publishTitle: gone
      ? goneTitle
      : isPublished
        ? 'This CV is already published'
        : dirty
          ? 'Save first - only the saved CV goes live'
          : locked
            ? 'Waiting for the CV photo upload to finish'
            : undefined,
    canSave: ready && !busy && !uploadingCvPhoto && !gone,
    canSaveAsNew: ready && !busy && !uploadingCvPhoto && gone,
    saveTitle: gone
      ? goneTitle
      : uploadingCvPhoto
        ? 'Waiting for the CV photo upload to finish'
        : undefined,
  }
}
