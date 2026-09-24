/**
 * Who is looking at a canvas, which decides the chrome around it - never the canvas itself.
 *
 * ```
 *   owner              /admin/whiteboard/<id>     everything: switcher, backup, export, share menu
 *   shared 'edit'      /whiteboard/<slug|id>      the canvas and its tools; Share = copy link
 *   shared 'view'      /whiteboard/<slug|id>      the canvas, read-only; Share = copy link
 * ```
 *
 * The server enforces the same split (share.ts); this only keeps the page from offering a
 * control whose request would be refused.
 */
export type BoardAccess =
  | { kind: 'owner' }
  | {
      kind: 'shared'
      mode: 'view' | 'edit'
      title: string
      /** `/whiteboard/<slug|id>`, what "Copy link" hands out. */
      path: string
    }

export const OWNER_ACCESS: BoardAccess = { kind: 'owner' }

/** `/whiteboard/<slug or id>`: the one shape of a share link, for both copy buttons. */
export function sharePath(board: { _id: string; slug: string | null }) {
  return `/whiteboard/${board.slug ?? board._id}`
}
