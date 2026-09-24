import 'server-only'

import { connectDatabase } from '@/lib/mongodb'
import { readJsonBody } from '@/lib/read-json-body'
import {
  bulkMoveItems,
  createItem,
  createLink,
  deleteItem,
  deleteLink,
  patchItem,
  patchLink,
  streamBoard,
} from '@/lib/whiteboard/data'
import {
  streamText,
  wbEntryError,
  wbError,
  wbJson,
} from '@/lib/whiteboard/http'
import {
  ITEM_MAX_BODY_BYTES,
  validateBulkUpdates,
  validateItem,
  validateItemPatch,
  validateLink,
  validateLinkPatch,
} from '@/lib/whiteboard/limits'

/**
 * The canvas endpoints, once, for both doors into a board.
 *
 * ```
 *   /api/admin/whiteboard/*?board=<id>     requireOwner + boardParam ─┐
 *                                                                     ├──▶ these handlers
 *   /api/whiteboard/shared/<key>/*         share link (share.ts) ─────┘      (parse, validate,
 *                                                                              data.ts, respond)
 * ```
 *
 * Each route file does its own access check and hands over the board id it proved; nothing
 * in here knows who is asking. That split is the point: the shared canvas has to behave
 * exactly like the owner's - the same caps, the same rule 8, the same error shapes the save
 * queue reads - and two copies of these bodies would drift the first time one of them was
 * fixed.
 *
 * Two things differ. A share link's creates carry `maxItems` (SHARED_BOARD_MAX_ITEMS), so
 * an edit link cannot grow a board without bound. And `aiControls`. The owner decides what their agents can read; a
 * visitor with an edit link does not, so a shared PATCH drops `includeInAi` (and the
 * `keepChildrenPrivate` that only rides along with it). Rule 8 still runs server-side for
 * everyone, so a card dragged out of a hidden frame through a share link still turns
 * private - that write only ever makes things MORE private.
 *
 * What this does NOT cover, on purpose (owner's call, D34): a CREATE through a share link
 * follows the normal default and may be agent-readable, including a card re-created under
 * the id of one that was hidden and deleted. The Share menu warns when an edit link is on a
 * board agents can read; hiding the board from AI is the way to keep visitors' text out.
 */

export async function streamCanvas(board: string) {
  try {
    // Connect before the stream starts, so "database down" is a clean 500 rather than a
    // stream that dies on its first line.
    await connectDatabase()
  } catch {
    return wbError('Unable to load the whiteboard right now.', 500)
  }
  async function* lines() {
    for await (const line of streamBoard(board))
      yield `${JSON.stringify(line)}\n`
  }
  return streamText(lines(), {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
  })
}

export async function createItemRoute(
  request: Request,
  board: string,
  /** A share link's cap on the board's size; the owner passes none. */
  options: { maxItems?: number } = {}
) {
  const parsed = await readJsonBody(request, { maxBytes: ITEM_MAX_BODY_BYTES })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateItem(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const result = await createItem(board, checked.value, options)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ item: result.value })
  } catch (error) {
    console.error('[whiteboard] create failed', error)
    return wbError('Unable to save the item right now.', 500)
  }
}

export async function bulkMoveRoute(request: Request, board: string) {
  const parsed = await readJsonBody(request, { maxBytes: ITEM_MAX_BODY_BYTES })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateBulkUpdates(parsed.body)
  if (!checked.ok)
    return wbEntryError(checked.error, checked.status, {
      id: checked.id,
      index: checked.index,
    })

  try {
    const result = await bulkMoveItems(board, checked.value)
    if (!result.ok)
      return wbEntryError(result.error, result.status, {
        id: result.id,
        index: result.index,
      })
    return wbJson({ items: result.value })
  } catch (error) {
    console.error('[whiteboard] bulk move failed', error)
    return wbError('Unable to save the positions right now.', 500)
  }
}

export async function patchItemRoute(
  request: Request,
  board: string,
  id: string,
  { aiControls }: { aiControls: boolean }
) {
  const parsed = await readJsonBody<Record<string, unknown>>(request, {
    maxBytes: ITEM_MAX_BODY_BYTES,
  })
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const { keepChildrenPrivate, ...fields } = parsed.body ?? {}
  if (
    keepChildrenPrivate !== undefined &&
    typeof keepChildrenPrivate !== 'boolean'
  )
    return wbError('keepChildrenPrivate must be a boolean.', 400)

  if (!aiControls && 'includeInAi' in fields) {
    delete fields.includeInAi
    // A patch that was ONLY the AI switch is refused out loud rather than answered with an
    // unchanged card: the canvas hides that switch on a shared board, so reaching here at
    // all means something is asking for what the link does not grant.
    if (Object.keys(fields).length === 0)
      return wbError('Only the owner can change what agents can read.', 403)
  }

  const checked = validateItemPatch(fields)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const result = await patchItem(board, id, checked.value, {
      keepChildrenPrivate: aiControls && keepChildrenPrivate === true,
    })
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ item: result.value })
  } catch (error) {
    console.error('[whiteboard] patch failed', error)
    return wbError('Unable to save the item right now.', 500)
  }
}

export async function deleteItemRoute(board: string, id: string) {
  try {
    const result = await deleteItem(board, id)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson(result.value)
  } catch (error) {
    console.error('[whiteboard] delete failed', error)
    return wbError('Unable to delete the item right now.', 500)
  }
}

export async function createLinkRoute(request: Request, board: string) {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateLink(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const result = await createLink(board, checked.value)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ link: result.value })
  } catch (error) {
    console.error('[whiteboard] link create failed', error)
    return wbError('Unable to save the link right now.', 500)
  }
}

export async function patchLinkRoute(
  request: Request,
  board: string,
  id: string
) {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const checked = validateLinkPatch(parsed.body)
  if (!checked.ok) return wbError(checked.error, checked.status)

  try {
    const result = await patchLink(board, id, checked.value)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ link: result.value })
  } catch (error) {
    console.error('[whiteboard] link patch failed', error)
    return wbError('Unable to save the link right now.', 500)
  }
}

export async function deleteLinkRoute(board: string, id: string) {
  try {
    const result = await deleteLink(board, id)
    if (!result.ok) return wbError(result.error, result.status)
    return wbJson({ ok: true })
  } catch (error) {
    console.error('[whiteboard] link delete failed', error)
    return wbError('Unable to delete the link right now.', 500)
  }
}
