import type { ClientItem, ClientLink } from '@/lib/whiteboard/types'

/**
 * What Delete does with a selection (R3-7), as a pure function so the rule is tested alone.
 *
 * ```
 *   links only ──────────▶ delete those links
 *   any item in it ──────▶ delete the items, and with them every link they touch plus the
 *                          selected ones; a frame's children stay (and stay private if the
 *                          frame was hidden)
 *   nothing ─────────────▶ nothing
 * ```
 *
 * Nothing here asks first any more (D30). The counts it works out are no longer a confirm's
 * title but the toast that reports the delete and offers the Undo - the same numbers, said
 * afterwards instead of before, next to the button that takes it back.
 */
export type DeletePlan =
  | { kind: 'links'; ids: string[] }
  | {
      kind: 'items'
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
  return { kind: 'items', items: itemIds, links, frameChildren, hiddenFrame }
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The toast a delete leaves behind: what went, and what stayed. */
export function deletedText(plan: NonNullable<DeletePlan>): string {
  if (plan.kind === 'links') return `${count(plan.ids.length, 'link')} deleted`
  const parts = [
    plan.links
      ? `${count(plan.items.length, 'item')} and ${count(plan.links, 'link')} deleted`
      : `${count(plan.items.length, 'item')} deleted`,
  ]
  // The one thing the confirm said that the counts do not: a frame goes, its cards do not.
  if (plan.frameChildren)
    parts.push(
      plan.hiddenFrame
        ? `${count(plan.frameChildren, 'item')} stay on the board, and stay private`
        : `${count(plan.frameChildren, 'item')} stay on the board`
    )
  return parts.join(' - ')
}
