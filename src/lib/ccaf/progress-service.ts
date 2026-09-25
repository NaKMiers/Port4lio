import 'server-only'

import { sanitizeState, type CcafState } from '@/lib/ccaf/progress'
import { connectDatabase } from '@/lib/mongodb'
import {
  CCAF_PROGRESS_DOCUMENT_ID,
  CcafProgressModel,
} from '@/models/CcafProgress'

/**
 * CCA-F progress writes - the tracker page's `PUT /api/ccaf`.
 *
 * ```
 *   PUT /api/ccaf ──▶ saveCcafState(body)        sanitizeState ──▶ null ──▶ 400 (caller)
 *                                                └─ upsert the WHOLE state (replace, never merge)
 * ```
 *
 * The PUT replaces the document (see its header: "I unticked everything" must be expressible),
 * and `sanitizeState` is the one place that bounds it.
 *
 * ## Why there is no MCP door any more
 *
 * This also used to back `ccaf_status` and `ccaf_update`, a conditional read-change-write for
 * agents. They were removed: `/admin/certificates` is meant to hold more certificate paths than
 * CCA-F, and a tool pair per certificate was the wrong shape for that. If agents get a way in
 * again, it should be certificate-generic, and it should still write through a service here
 * rather than inside the tool.
 */

/** Upsert a sanitised state. `null` when the body is not a usable state (the route's 400). */
export async function saveCcafState(body: unknown): Promise<CcafState | null> {
  const state = sanitizeState(body)
  if (!state) return null

  await connectDatabase()
  const now = new Date()
  await CcafProgressModel.findOneAndUpdate(
    { _id: CCAF_PROGRESS_DOCUMENT_ID },
    {
      $set: { ...state, updatedAt: now },
      $setOnInsert: { _id: CCAF_PROGRESS_DOCUMENT_ID, createdAt: now },
    },
    { upsert: true, returnDocument: 'after', lean: true, runValidators: true }
  )
  return state
}
