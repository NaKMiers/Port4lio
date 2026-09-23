import type { ClientItem, ClientLink } from '@/lib/whiteboard/types'

/**
 * What Delete does with a selection (R3-7), as a pure function so the rule is tested alone.
 *
 * ```
 *   links only ──────────▶ delete them now, no confirm (a lone link is cheap to redraw)
 *   any item in it ──────▶ confirm "Delete 3 items and 5 links?", counting every link the
 *                          items take with them plus selected links; a frame's children
 *                          stay (and stay private if the frame was hidden)
 *   nothing ─────────────▶ nothing
 * ```
 */
export type DeletePlan =
  | { kind: 'links'; ids: string[] }
  | {
      kind: 'confirm'
      items: string[]
      links: number
      frameChildren: number
      hiddenFrame: boolean
    }
  | null

export function deletePlan(
  selection: { nodes: string[]; edges: string[] },
  data: {
    items: Record<string, ClientItem>
    links: Record<string, ClientLink>
  }
): DeletePlan {
  const itemIds = selection.nodes.filter(id => data.items[id])
  if (itemIds.length === 0)
    return selection.edges.length
      ? { kind: 'links', ids: selection.edges }
      : null

  const set = new Set(itemIds)
  const links = Object.values(data.links).filter(
    link =>
      set.has(link.from) ||
      set.has(link.to) ||
      selection.edges.includes(link._id)
  ).length
  const frames = itemIds.filter(id => data.items[id].form === 'frame')
  const frameChildren = Object.values(data.items).filter(
    item =>
      item.parentId && frames.includes(item.parentId) && !set.has(item._id)
  ).length
  const hiddenFrame = frames.some(id => !data.items[id].includeInAi)
  return { kind: 'confirm', items: itemIds, links, frameChildren, hiddenFrame }
}
