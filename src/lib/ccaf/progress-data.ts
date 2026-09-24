import { cookies } from 'next/headers'

import { hasOwnerAccess } from '@/lib/admin-gate'
import { getAuthCookieName } from '@/lib/auth'
import { emptyState, type CcafState } from '@/lib/ccaf/progress'
import { connectDatabase } from '@/lib/mongodb'
import {
  CCAF_PROGRESS_DOCUMENT_ID,
  CcafProgressModel,
  type CcafProgressDocument,
} from '@/models/CcafProgress'

/**
 * Server-side read of the CCA-F progress document. Deliberately uncached.
 *
 * ## Why not `unstable_cache`, when `profile-data.ts` uses it
 *
 * It was written that way first, and the caching was measurably wrong: after
 * `PUT /api/ccaf`, `revalidateTag` did not invalidate the entry, and `GET /api/ccaf`
 * kept serving the previous state until the 60-second window expired on its own.
 * Saving and reloading inside that window showed the save missing - the single most
 * corrosive bug a tracker can have, because the data is fine and only the page lies.
 *
 * The wrapper is also redundant now that the page is owner-only. It renders under the
 * admin layout's `force-dynamic`, so there is no ISR window left for a second,
 * independently-stale layer to hide underneath. This function always reads Mongo, which is
 * what makes it authoritative. One small query per call, on a page one person opens.
 */
export async function loadCcafState(): Promise<CcafState> {
  try {
    await connectDatabase()
    const doc = await CcafProgressModel.findById(
      CCAF_PROGRESS_DOCUMENT_ID
    ).lean()
    return stateFromDocument(doc)
  } catch (error) {
    // Deliberately not rethrown. This is a study tracker; a database blip should degrade it
    // to the plan with no ticks, not 500 the route and take the roadmap - which is static
    // content - down with it. (A WRITER must not read through this - it would save the empty
    // defaults over the real state. `applyCcafUpdate` reads the document itself.)
    console.error('[ccaf] failed to load progress, serving defaults', error)
    return emptyState()
  }
}

/** The stored document as a state, defaults filled in. `null` (never saved) is the empty plan. */
export function stateFromDocument(
  doc: Partial<CcafProgressDocument> | null
): CcafState {
  if (!doc) return emptyState()
  const fallback = emptyState()
  return {
    doneTaskIds: doc.doneTaskIds ?? fallback.doneTaskIds,
    // Padded against the stored length rather than trusted: a document written before a
    // sixth domain existed would otherwise hand `undefined` to the sliders.
    confidence: fallback.confidence.map((_, i) => doc.confidence?.[i] ?? 0),
    mocks: (doc.mocks ?? []).map(mock => ({
      id: mock.id,
      date: mock.date,
      label: mock.label,
      correct: mock.correct,
      domainPercents: fallback.confidence.map(
        (_, i) => mock.domainPercents?.[i] ?? null
      ),
    })),
    doneCheckIds: doc.doneCheckIds ?? fallback.doneCheckIds,
    examDate: doc.examDate || fallback.examDate,
  }
}

/**
 * The page's read: the same state, but only for a request that already proves ownership.
 *
 * The distinction from `loadCcafState` is the whole privacy model of the route. A gate in
 * the browser can hide the tracker; it cannot take back HTML the server already wrote, and
 * this page renders the plan on the server. So the cookie is checked before the query
 * rather than after it, and a stranger's render has nothing in it to hide.
 *
 * `hasOwnerAccess` rather than `verifyAuthToken`, so the local `REQUIRE_ADMIN=false` bypass
 * reaches this page too - a dev-mode editor that renders permanently empty would be worse
 * than no bypass at all.
 */
export async function loadOwnerCcafState(): Promise<CcafState | null> {
  const store = await cookies()
  if (!hasOwnerAccess(store.get(getAuthCookieName())?.value)) return null
  return loadCcafState()
}
