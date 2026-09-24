import type { UnparentedChild } from '@/components/whiteboard/save-queue'
import type { ClientItem, ClientLink } from '@/lib/whiteboard/types'

/**
 * Undo/redo on the canvas (D30): board snapshots, and the diff that turns one back into
 * writes the save queue can carry.
 *
 * ```
 *   every edit ──▶ commit() ──▶ push the state BEFORE it onto `past`   (useBoard)
 *                                    │ same label within 700 ms: merge into the top entry
 *                                    ▼
 *   Cmd/Ctrl+Z ──▶ planRestore(now, past.pop()) ──▶ createItem / patchItem / deleteItem
 *                            │                      createLink  / patchLink / deleteLink
 *                            └─▶ next: the state to render, with resurrected ids remapped
 * ```
 *
 * ## Why snapshots and not an inverse per action
 *
 * `useBoard.commit` is the one function every local edit passes through - create, edit, move,
 * delete, connect, relabel, and the compound ones (deleting a frame also un-parents its
 * children; un-hiding a frame can rewrite every child). Recording there cannot miss an
 * action or record half of a compound one. An inverse command per action would be nine
 * hand-written inverses that have to stay in step with nine actions, and the day one drifts
 * the failure is silent: undo leaves the board in a state that never existed.
 *
 * Snapshots are cheap here because the items are never mutated in place - a snapshot is a
 * fresh map of the same object references, so 60 of them cost 60 maps, not 60 boards.
 *
 * ## Why an undone delete comes back under a NEW id
 *
 * R3-6: once an id is deleted it is dead for the session. The queue refuses every later op
 * for it, which is the whole guarantee that a create still retrying in the background cannot
 * resurrect a card the owner deleted. Undo does not get an exception - reviving the id would
 * mean a create racing its own DELETE, and whichever lands last wins. So undo re-creates the
 * card as a copy under a fresh id, with every field (`includeInAi` included, so a hidden
 * card comes back hidden) and the links it took with it.
 *
 * The cost is that the id in the rest of the history is stale, so `remapSnapshot` rewrites
 * the remaining entries. Without it a second undo would see "an item the snapshot has and
 * the board does not" and delete and re-create the same card again, walking it through a new
 * id on every step.
 */

export interface BoardSnapshot {
  items: Record<string, ClientItem>
  links: Record<string, ClientLink>
}

/** Everything an item carries that the owner can change (limits.ts `PATCH_KEYS`). */
const FIELDS = [
  'meaning',
  'status',
  'title',
  'body',
  'todos',
  'shape',
  'ink',
  'parentId',
  'x',
  'y',
  'width',
  'height',
  'z',
  'tags',
  'when',
  'targetBy',
  'includeInAi',
] as const satisfies readonly (keyof ClientItem)[]

export interface RestorePlan {
  /** The board as it should look now, ready to render. */
  next: BoardSnapshot
  createItems: ClientItem[]
  patchItems: { id: string; patch: Partial<ClientItem> }[]
  deleteItems: string[]
  /** Frames going away that still hold children: their queued writes need rewriting. */
  unparent: { frameId: string; children: UnparentedChild[] }[]
  createLinks: ClientLink[]
  patchLinks: { id: string; label: string }[]
  deleteLinks: string[]
  /** Old id -> the id its copy came back under. Empty unless something was resurrected. */
  remap: Map<string, string>
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key in right && deepEqual(left[key], right[key]))
}

/** Only the fields that differ (R3-1: a patch never carries a field it did not change). */
export function fieldDiff(
  live: ClientItem,
  wanted: ClientItem
): Partial<ClientItem> | null {
  const patch: Record<string, unknown> = {}
  for (const key of FIELDS)
    if (!deepEqual(live[key], wanted[key])) patch[key] = wanted[key]
  return Object.keys(patch).length ? (patch as Partial<ClientItem>) : null
}

export function isNoOp(plan: RestorePlan): boolean {
  return (
    plan.createItems.length === 0 &&
    plan.patchItems.length === 0 &&
    plan.deleteItems.length === 0 &&
    plan.createLinks.length === 0 &&
    plan.patchLinks.length === 0 &&
    plan.deleteLinks.length === 0
  )
}

/**
 * What it takes to turn `current` into `target`. Pure: `isDead` answers the queue's "this id
 * is spent" rule and `newId` mints the replacement, so the plan can be tested with neither.
 */
export function planRestore(
  current: BoardSnapshot,
  target: BoardSnapshot,
  { isDead, newId }: { isDead: (id: string) => boolean; newId: () => string }
): RestorePlan {
  const remap = new Map<string, string>()
  for (const id of Object.keys(target.items))
    if (!current.items[id] && isDead(id)) remap.set(id, newId())
  for (const id of Object.keys(target.links))
    if (!current.links[id] && isDead(id)) remap.set(id, newId())
  const live = (id: string) => remap.get(id) ?? id

  // MARK: Items

  const nextItems: Record<string, ClientItem> = {}
  const createItems: ClientItem[] = []
  const patchItems: RestorePlan['patchItems'] = []
  for (const item of Object.values(target.items)) {
    const id = live(item._id)
    const wanted: ClientItem = {
      ...item,
      _id: id,
      parentId: item.parentId ? live(item.parentId) : null,
    }
    nextItems[id] = wanted
    const now = current.items[id]
    if (!now) {
      createItems.push(wanted)
      continue
    }
    const patch = fieldDiff(now, wanted)
    if (patch) patchItems.push({ id, patch })
  }

  const deleteItems: string[] = []
  const unparent: RestorePlan['unparent'] = []
  for (const item of Object.values(current.items)) {
    if (nextItems[item._id]) continue
    deleteItems.push(item._id)
    if (item.form !== 'frame') continue
    const children: UnparentedChild[] = []
    for (const child of Object.values(current.items)) {
      if (child.parentId !== item._id) continue
      const after = nextItems[child._id]
      if (!after || after.parentId !== null) continue
      children.push({
        id: after._id,
        x: after.x,
        y: after.y,
        hidden: !after.includeInAi,
      })
    }
    if (children.length) unparent.push({ frameId: item._id, children })
  }

  // MARK: Links

  const nextLinks: Record<string, ClientLink> = {}
  const createLinks: ClientLink[] = []
  const patchLinks: RestorePlan['patchLinks'] = []
  for (const link of Object.values(target.links)) {
    const id = live(link._id)
    const wanted: ClientLink = {
      ...link,
      _id: id,
      from: live(link.from),
      to: live(link.to),
    }
    // A link to a card that is not coming back would be a 400 the owner cannot fix.
    if (!nextItems[wanted.from] || !nextItems[wanted.to]) continue
    nextLinks[id] = wanted
    const now = current.links[id]
    if (!now) createLinks.push(wanted)
    else if (now.label !== wanted.label)
      patchLinks.push({ id, label: wanted.label })
  }

  const doomed = new Set(deleteItems)
  const deleteLinks = Object.values(current.links)
    .filter(link => !nextLinks[link._id])
    // The server deletes the links of an item it deletes, so naming them again is a 404.
    .filter(link => !doomed.has(link.from) && !doomed.has(link.to))
    .map(link => link._id)

  return {
    next: { items: nextItems, links: nextLinks },
    createItems,
    patchItems,
    deleteItems,
    unparent,
    createLinks,
    patchLinks,
    deleteLinks,
    remap,
  }
}

/**
 * The same snapshot with resurrected ids swapped in, so the entries still on the stack talk
 * about the cards that are on the board now. Returns the snapshot unchanged when nothing in
 * it was remapped, which is every undo that did not bring a card back.
 */
export function remapSnapshot(
  snapshot: BoardSnapshot,
  remap: Map<string, string>
): BoardSnapshot {
  if (remap.size === 0) return snapshot
  let touched = false
  const items: Record<string, ClientItem> = {}
  for (const item of Object.values(snapshot.items)) {
    const id = remap.get(item._id) ?? item._id
    const parentId = item.parentId
      ? (remap.get(item.parentId) ?? item.parentId)
      : null
    if (id !== item._id || parentId !== item.parentId) {
      touched = true
      items[id] = { ...item, _id: id, parentId }
    } else items[id] = item
  }
  const links: Record<string, ClientLink> = {}
  for (const link of Object.values(snapshot.links)) {
    const id = remap.get(link._id) ?? link._id
    const from = remap.get(link.from) ?? link.from
    const to = remap.get(link.to) ?? link.to
    if (id !== link._id || from !== link.from || to !== link.to) {
      touched = true
      links[id] = { ...link, _id: id, from, to }
    } else links[id] = link
  }
  return touched ? { items, links } : snapshot
}
