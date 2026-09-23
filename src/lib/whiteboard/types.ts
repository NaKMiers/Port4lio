import type {
  Form,
  InkBBox,
  InkPoint,
  Meaning,
  Shape,
  Status,
  TodoRow,
} from '@/lib/whiteboard/limits'

/**
 * Wire shapes shared by the routes and the canvas. Pure types, safe to import anywhere.
 *
 * Dates travel as strings: `when` / `targetBy` as `YYYY-MM-DD` (they are calendar days,
 * D22), timestamps as ISO instants. The backup file uses exactly these shapes, which is what
 * makes it re-importable through the same validators.
 */

export interface ClientItem {
  _id: string
  form: Form
  meaning: Meaning | null
  status: Status | null
  title: string
  body: string
  todos: TodoRow[]
  shape: Shape | null
  ink: { points: InkPoint[]; bbox: InkBBox } | null
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  z: number
  tags: string[]
  when: string | null
  targetBy: string | null
  includeInAi: boolean
  createdAt: string
  updatedAt: string
}

export interface ClientLink {
  _id: string
  from: string
  to: string
  label: string
  fromHandle: string | null
  toHandle: string | null
}

/** One line of the `GET /api/admin/whiteboard` NDJSON stream (D21, D28). */
export type BoardLine =
  | { t: 'start'; items: number; links: number }
  | { t: 'item'; item: ClientItem }
  | { t: 'link'; link: ClientLink }
  /** Written last. A stream without it was cut, and the board must not become editable. */
  | { t: 'end'; items: number; links: number }

export type ExportScope =
  | { kind: 'all' }
  | { kind: 'frame'; id: string }
  | { kind: 'selection'; ids: string[] }
  | {
      kind: 'filter'
      meanings?: Meaning[]
      status?: Status[]
      from?: string
      to?: string
      targetFrom?: string
      targetTo?: string
    }

/** `POST /api/admin/whiteboard/context` (D25). */
export interface ContextResponse {
  markdown: string
  /** In-scope items the privacy filter dropped. */
  excludedCount: number
  /** The frame scope names a frame that is itself hidden. */
  scopeHidden: boolean
  totalCount: number
  renderedCount: number
  truncated: boolean
}

export interface ClientToken {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface RestoreBatchResult {
  items: number
  links: number
  /** Ids in this batch that were already in the database. */
  existing: number
  written: number
}
