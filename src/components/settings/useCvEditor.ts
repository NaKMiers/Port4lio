'use client'

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { pruneResumeForCv } from '@/components/settings/cleanProfileForSave'
import * as cvState from '@/components/settings/cv-editor-state'
import { MAX_CV_JSON_BYTES } from '@/lib/upload-limits'
import {
  CvApiError,
  createCvApi,
  deleteCvApi,
  listCvsApi,
  publishCvApi,
  saveCvApi,
} from '@/requests/cvs'
import type { Resume, ResumePageBreak } from '@/types/profile'

/**
 * The CV tab's data: the CV list, the selected CV's draft, and every CV action.
 *
 * Called from `SettingEditor`, not from `CvTabSections`, on purpose (multi-cv-plan.md OV-4):
 * the tab's cards unmount on every tab switch, and a draft held there would be dropped the
 * moment the owner glanced at the Profile tab. Up here it survives, and the preview rail can
 * render it.
 *
 * ```
 *   active (the CV tab opened) ──▶ first time only: GET /api/admin/cvs   (migrates "Main CV")
 *   save(overwrite)  PATCH { resume: pruneResumeForCv(draft), base | '*' }
 *                      409 stale ──▶ state.stale, the CV banner (Reload / Overwrite)
 *   reload()         GET again, draft reset to the server copy - never refetchProfile, which
 *                    would unmount the whole editor (OV-5)
 *   create / rename  PATCH / POST; a 409 message goes back to the dialog, shown inline (D6)
 *   publish / remove POST publish / DELETE; failures go to the page's error banner
 * ```
 *
 * Loading waits for the tab: `/cv` keeps printing the legacy block until the owner opens the
 * CV tab, which is what makes the lazy migration (D5) a deliberate act rather than a side
 * effect of visiting settings.
 */
export function useCvEditor({
  active,
  onError,
}: {
  /** Whether the CV tab is showing. The list loads the first time it is. */
  active: boolean
  /** The page's error banner. */
  onError: (message: string | null) => void
}) {
  const [state, setState] = useState(cvState.initialCvEditorState)
  const [busy, setBusy] = useState(false)
  // Save CV's own label ("Saving..."), separate from the other CV requests `busy` covers.
  const [saving, setSaving] = useState(false)
  // Actions read the latest state without being re-created on every keystroke. A layout
  // effect, not a passive one: it runs inside the commit, so a click landing right after an
  // update (an upload finishing) can never read the state from before it.
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })

  const load = useCallback(async (preferId?: string | null) => {
    setState(s => cvState.loading(s))
    try {
      const list = await listCvsApi()
      setState(s => cvState.loaded(s, list, preferId ?? s.selectedId))
    } catch (error) {
      setState(s =>
        cvState.failed(
          s,
          error instanceof Error ? error.message : 'Unable to load the CVs.'
        )
      )
    }
  }, [])

  const startedRef = useRef(false)
  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    void load()
  }, [active, load])

  const setDraft: React.Dispatch<React.SetStateAction<Resume>> = useCallback(
    update => setState(s => cvState.editDraft(s, update)),
    []
  )

  const onClippedRefit = useCallback(
    (pageBreak: ResumePageBreak) =>
      setState(s => cvState.autoFitted(s, pageBreak)),
    []
  )

  const select = useCallback(
    (id: string) => setState(s => cvState.selected(s, id)),
    []
  )

  /** Runs one CV request with the busy flag held, reporting failures to the banner. */
  const run = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true)
      onError(null)
      try {
        await task()
      } catch (error) {
        onError(error instanceof Error ? error.message : 'CV request failed')
      } finally {
        setBusy(false)
      }
    },
    [onError]
  )

  const save = useCallback(
    (overwrite = false) =>
      run(async () => {
        const { selectedId, draft, base } = stateRef.current
        if (!selectedId || !draft) return
        setSaving(true)
        try {
          await saveDraft(selectedId, draft, overwrite || !base ? '*' : base)
        } finally {
          setSaving(false)
        }
      }),
    [run]
  )

  async function saveDraft(id: string, draft: Resume, base: string) {
    const resume = pruneResumeForCv(draft)
    // The whole body, as the server's readJsonBody measures it - not just the resume.
    if (
      new TextEncoder().encode(JSON.stringify({ resume, base })).length >
      MAX_CV_JSON_BYTES
    )
      throw new Error(
        `This CV is over the ${MAX_CV_JSON_BYTES / 1024} KB limit.`
      )
    try {
      const { cv } = await saveCvApi(id, { resume, base })
      setState(s => cvState.saved(s, cv, draft))
    } catch (error) {
      if (error instanceof CvApiError && error.code === 'stale') {
        setState(s => cvState.markStale(s))
        return
      }
      throw error
    }
  }

  const reload = useCallback(() => {
    onError(null)
    return load(stateRef.current.selectedId)
  }, [load, onError])

  /** Resolves to an error message for the dialog, or `null` on success. */
  const create = useCallback(async (label: string): Promise<string | null> => {
    const fromId = stateRef.current.selectedId
    if (!fromId) return 'Pick a CV to copy first.'
    setBusy(true)
    try {
      const { cv } = await createCvApi(label, fromId)
      setState(s => cvState.created(s, cv))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Unable to create the CV.'
    } finally {
      setBusy(false)
    }
  }, [])

  /** Resolves to an error message for the dialog, or `null` on success. */
  const rename = useCallback(async (label: string): Promise<string | null> => {
    const { selectedId, base } = stateRef.current
    if (!selectedId) return 'Pick a CV first.'
    setBusy(true)
    try {
      const { cv } = await saveCvApi(selectedId, { label, base: base ?? '*' })
      setState(s => cvState.renamed(s, cv))
      return null
    } catch (error) {
      if (error instanceof CvApiError && error.code === 'stale') {
        setState(s => cvState.markStale(s))
        return 'This CV changed in another tab. Close this, reload the CV, then rename it.'
      }
      return error instanceof Error ? error.message : 'Unable to rename the CV.'
    } finally {
      setBusy(false)
    }
  }, [])

  const publish = useCallback(
    () =>
      run(async () => {
        const id = stateRef.current.selectedId
        if (!id) return
        const { publishedId } = await publishCvApi(id)
        setState(s => cvState.published(s, publishedId))
      }),
    [run]
  )

  const remove = useCallback(
    () =>
      run(async () => {
        const id = stateRef.current.selectedId
        if (!id) return
        await deleteCvApi(id)
        setState(s => cvState.deleted(s, id))
      }),
    [run]
  )

  return {
    state,
    busy,
    saving,
    dirty: cvState.isDirty(state),
    selected: cvState.selectedCv(state),
    gates: (uploadingCvPhoto: boolean) =>
      cvState.cvActionGates(state, { busy, uploadingCvPhoto }),
    setDraft,
    onClippedRefit,
    select,
    save,
    reload,
    retry: () => void load(),
    create,
    rename,
    publish,
    remove,
  }
}

export type CvEditor = ReturnType<typeof useCvEditor>
