/**
 * The whiteboard's value sets, caps and validators, with no server imports.
 *
 * ```
 *   Inspector (client) ──┐
 *   item/link routes ────┼──▶ limits.ts  ──▶ one verdict for the same input
 *   restore pre-check ───┘   (pure, no mongoose, no server-only)
 * ```
 *
 * ## Why one module and not three copies
 *
 * The inspector stops typing at 20,000 characters, the server rejects 20,001, and the
 * restore dialog refuses a backup file with a 20,001-character body before a single batch is
 * sent. Those are three places that must agree, and the day one of them drifts the failure
 * is quiet: the inspector lets you type something the server then rejects with a 400, which
 * the save queue treats as permanent (4xx is never retried), so the card is marked unsaved
 * for a reason the UI said was fine. Keeping the numbers and the checks here, importable from
 * a client component, is what makes that drift impossible rather than unlikely. Same
 * reasoning as `lib/blog/constants.ts`, which exists because a model import dragged mongoose
 * into the browser bundle.
 *
 * ## What is NOT here
 *
 * Anything that needs the database: "parentId exists and is a frame", "both link ends
 * exist", "not a duplicate link". Those live in `data.ts`. This module answers "is this
 * payload well-formed", never "is it consistent with what is stored".
 */

// MARK: Value sets

export const FORMS = ['text', 'todo', 'shape', 'frame', 'ink'] as const
export type Form = (typeof FORMS)[number]

/**
 * A meaning or a status is a KEY into the owner-editable vocabulary (`vocab.ts`). Here it is
 * only checked for shape; whether the key exists is a database question, answered in
 * `data.ts` like "parentId is a frame".
 */
export type Meaning = string
export type Status = string

/** Lowercase, a letter first, then letters, digits and hyphens (up to 32). What an item stores. */
export const VOCAB_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

export const SHAPES = ['rect', 'ellipse', 'diamond'] as const
export type Shape = (typeof SHAPES)[number]

/**
 * The owner's timezone, for the `createdAt` fallback of the date rule (D22).
 *
 * `when` / `targetBy` are calendar days and carry no timezone at all. `createdAt` is an
 * instant, so "what did I write in 2025" has to turn it into a day somewhere, and doing that
 * in UTC would file a card written at 06:00 on 1 January in Vietnam under 31 December.
 */
export const WHITEBOARD_TIMEZONE = 'Asia/Ho_Chi_Minh'

// MARK: Caps

export const LIMITS = {
  title: 200,
  body: 20_000,
  todos: 100,
  todoText: 500,
  inkPoints: 2_000,
  tags: 20,
  tagLength: 40,
  linkLabel: 80,
  /** Bulk `PATCH /items` entries per request. */
  bulkUpdates: 500,
  /** `search_context` query length. */
  searchQuery: 200,
  /** Canvas coordinates. Generous; only here so `Infinity` and 1e308 are refused. */
  coordinate: 10_000_000,
  size: 100_000,
} as const

/** Body caps for `readJsonBody`, per route family. */
export const ITEM_MAX_BODY_BYTES = 256 * 1024
export const RESTORE_MAX_BODY_BYTES = 2 * 1024 * 1024

// MARK: Primitive checks

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
}

/** Titles, link labels, todo rows and tags are one line. A newline is rejected, not folded. */
export function isSingleLine(value: string): boolean {
  return !/[\r\n\u2028\u2029]/.test(value)
}

/**
 * A calendar day, stored as UTC midnight (D22).
 *
 * Accepts `YYYY-MM-DD`, or any ISO string starting with one - a backup file carries
 * `2025-03-14T00:00:00.000Z`, and its day is the prefix. The time part is ignored on
 * purpose: these fields mean "a day", and honouring a time would reintroduce exactly the
 * midnight drift D22 exists to remove.
 */
export function parseDay(value: unknown): Date | null | undefined {
  if (value === null) return null
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? undefined
      : new Date(
          Date.UTC(
            value.getUTCFullYear(),
            value.getUTCMonth(),
            value.getUTCDate()
          )
        )
  if (typeof value !== 'string') return undefined

  const match = DAY_PATTERN.exec(value)
  if (!match) return undefined

  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  // Rejects 2025-02-30, which Date.UTC would silently roll into March.
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d))
    return undefined
  return date
}

// MARK: Ink geometry

export type InkPoint = [number, number, number]
export interface InkBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * The stroke's bounding box, local to the ink item's own `x/y`.
 *
 * Derived by the server on every write and never read from a client or a file (D27): the
 * box is what every agent read uses in place of the points, so a stale or forged one would
 * put a sketch's "near" label next to the wrong cards.
 */
export function deriveInkBBox(points: readonly InkPoint[]): InkBBox {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

// MARK: Validated shapes

export interface TodoRow {
  id: string
  text: string
  done: boolean
}

/** Every field of an item except the server-owned ones (`ink.bbox`, timestamps). */
export interface ItemFields {
  _id: string
  form: Form
  meaning: Meaning | null
  status: Status | null
  title: string
  body: string
  todos: TodoRow[]
  shape: Shape | null
  ink: { points: InkPoint[] } | null
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  z: number
  tags: string[]
  when: Date | null
  targetBy: Date | null
  includeInAi: boolean
}

/** The editable subset. `_id` and `form` are fixed at create. */
export type ItemPatch = Partial<Omit<ItemFields, '_id' | 'form'>>

export interface LinkFields {
  _id: string
  from: string
  to: string
  label: string
  fromHandle: string | null
  toHandle: string | null
}

export type Verdict<T> =
  | { ok: true; value: T }
  /** `status` is 413 for an over-cap ink stroke and 400 for everything else. */
  | { ok: false; status: 400 | 413; error: string }

const fail = (error: string, status: 400 | 413 = 400) =>
  ({ ok: false, status, error }) as const

// MARK: Field validators

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string }

function singleLine(
  name: string,
  value: unknown,
  max: number
): FieldResult<string> {
  if (typeof value !== 'string')
    return { ok: false, error: `${name} must be a string.` }
  if (!isSingleLine(value))
    return { ok: false, error: `${name} must be a single line.` }
  if (value.length > max)
    return { ok: false, error: `${name} is over ${max} characters.` }
  return { ok: true, value }
}

function finite(name: string, value: unknown, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return { ok: false, error: `${name} must be a number.` } as const
  if (Math.abs(value) > max)
    return { ok: false, error: `${name} is out of range.` } as const
  return { ok: true, value } as const
}

function oneOf<T extends string>(
  name: string,
  value: unknown,
  set: readonly T[],
  nullable: boolean
): FieldResult<T | null> {
  if (value === null && nullable) return { ok: true, value: null }
  if (typeof value === 'string' && (set as readonly string[]).includes(value))
    return { ok: true, value: value as T }
  return { ok: false, error: `${name} must be one of ${set.join(', ')}.` }
}

function validateTodos(value: unknown): FieldResult<TodoRow[]> {
  if (!Array.isArray(value))
    return { ok: false, error: 'todos must be an array.' }
  if (value.length > LIMITS.todos)
    return { ok: false, error: `todos is over ${LIMITS.todos} rows.` }

  const rows: TodoRow[] = []
  for (const [index, row] of value.entries()) {
    if (!row || typeof row !== 'object')
      return { ok: false, error: `todos[${index}] must be an object.` }
    const { id, text, done } = row as Record<string, unknown>
    if (typeof id !== 'string' || !id || id.length > 64)
      return { ok: false, error: `todos[${index}].id is required.` }
    const checked = singleLine(`todos[${index}].text`, text, LIMITS.todoText)
    if (!checked.ok) return checked
    if (typeof done !== 'boolean')
      return { ok: false, error: `todos[${index}].done must be a boolean.` }
    rows.push({ id, text: checked.value, done })
  }
  return { ok: true, value: rows }
}

function validateTags(value: unknown): FieldResult<string[]> {
  if (!Array.isArray(value))
    return { ok: false, error: 'tags must be an array.' }
  if (value.length > LIMITS.tags)
    return { ok: false, error: `tags is over ${LIMITS.tags} entries.` }

  const tags: string[] = []
  for (const [index, tag] of value.entries()) {
    const checked = singleLine(`tags[${index}]`, tag, LIMITS.tagLength)
    if (!checked.ok) return checked
    const trimmed = checked.value.trim()
    if (!trimmed) return { ok: false, error: `tags[${index}] is empty.` }
    tags.push(trimmed)
  }
  return { ok: true, value: tags }
}

/** Returns a 413-flavoured failure for the one cap that is about size, not shape. */
function validateInk(
  value: unknown
):
  | { ok: true; value: { points: InkPoint[] } | null }
  | { ok: false; error: string; status: 400 | 413 } {
  if (value === null) return { ok: true, value: null }
  if (!value || typeof value !== 'object')
    return { ok: false, error: 'ink must be an object.', status: 400 }

  const points = (value as { points?: unknown }).points
  if (!Array.isArray(points))
    return { ok: false, error: 'ink.points must be an array.', status: 400 }
  if (points.length > LIMITS.inkPoints)
    return {
      ok: false,
      error: `ink.points is over ${LIMITS.inkPoints} points.`,
      status: 413,
    }

  const clean: InkPoint[] = []
  for (const [index, point] of points.entries()) {
    if (!Array.isArray(point) || point.length < 2 || point.length > 3)
      return {
        ok: false,
        error: `ink.points[${index}] must be [x, y] or [x, y, pressure].`,
        status: 400,
      }
    const [x, y, pressure = 0.5] = point as unknown[]
    const values = [x, y, pressure]
    if (
      !values.every(
        v =>
          typeof v === 'number' &&
          Number.isFinite(v) &&
          Math.abs(v) <= LIMITS.coordinate
      )
    )
      return {
        ok: false,
        error: `ink.points[${index}] must be finite numbers.`,
        status: 400,
      }
    clean.push([x as number, y as number, pressure as number])
  }
  return { ok: true, value: { points: clean } }
}

/**
 * Validate one editable field. Shared by create (every field) and PATCH (only the fields
 * sent). The switch is the single list of what an item can hold.
 */
function validateField(
  key: keyof ItemPatch,
  value: unknown
):
  | { ok: true; value: unknown }
  | { ok: false; error: string; status?: 400 | 413 } {
  switch (key) {
    case 'meaning':
    case 'status':
      if (value === null) return { ok: true, value: null }
      if (typeof value === 'string' && VOCAB_KEY_PATTERN.test(value))
        return { ok: true, value }
      return {
        ok: false,
        error: `${key} must be a key (a-z, 0-9, hyphens) or null.`,
      }
    case 'shape':
      return oneOf('shape', value, SHAPES, true)
    case 'title':
      return singleLine('title', value, LIMITS.title)
    case 'body':
      if (typeof value !== 'string')
        return { ok: false, error: 'body must be a string.' }
      if (value.length > LIMITS.body)
        return { ok: false, error: `body is over ${LIMITS.body} characters.` }
      return { ok: true, value }
    case 'todos':
      return validateTodos(value)
    case 'tags':
      return validateTags(value)
    case 'ink':
      return validateInk(value)
    case 'parentId':
      if (value === null || isObjectIdString(value))
        return { ok: true, value: value === null ? null : value.toLowerCase() }
      return { ok: false, error: 'parentId must be an ObjectId or null.' }
    case 'x':
    case 'y':
    case 'z':
      return finite(key, value, LIMITS.coordinate)
    case 'width':
    case 'height': {
      const checked = finite(key, value, LIMITS.size)
      if (checked.ok && checked.value < 0)
        return { ok: false, error: `${key} must not be negative.` }
      return checked
    }
    case 'when':
    case 'targetBy': {
      const day = parseDay(value)
      if (day === undefined)
        return { ok: false, error: `${key} must be YYYY-MM-DD or null.` }
      return { ok: true, value: day }
    }
    case 'includeInAi':
      if (typeof value !== 'boolean')
        return { ok: false, error: 'includeInAi must be a boolean.' }
      return { ok: true, value }
  }
}

const PATCH_KEYS: readonly (keyof ItemPatch)[] = [
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
]

const ITEM_DEFAULTS: Omit<ItemFields, '_id' | 'form'> = {
  meaning: null,
  status: null,
  title: '',
  body: '',
  todos: [],
  shape: null,
  ink: null,
  parentId: null,
  x: 0,
  y: 0,
  width: 240,
  height: 120,
  z: 0,
  tags: [],
  when: null,
  targetBy: null,
  includeInAi: true,
}

/** Form-specific rules that only make sense on a whole item. */
function checkFormRules(item: ItemFields): string | null {
  if (item.form === 'frame' && item.parentId)
    return 'A frame cannot be inside another frame.'
  if (item.form === 'shape' && !item.shape) return 'A shape item needs a shape.'
  if (item.form === 'ink' && !item.ink) return 'An ink item needs ink.points.'
  if (item.form !== 'shape' && item.shape)
    return 'Only a shape item has a shape.'
  if (item.form !== 'ink' && item.ink) return 'Only an ink item has ink.'
  if (item.form !== 'todo' && item.todos.length > 0)
    return 'Only a to-do item has todos.'
  if (item.parentId && item.parentId === item._id)
    return 'An item cannot be its own parent.'
  return null
}

// MARK: Item validators

/**
 * A whole item: a create, or one entry of a backup file. Unknown keys are ignored (that is
 * how a client-sent `ink.bbox` or `createdAt` is dropped), missing editable keys take their
 * defaults.
 */
export function validateItem(input: unknown): Verdict<ItemFields> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail('Item must be an object.')
  const raw = input as Record<string, unknown>

  if (!isObjectIdString(raw._id)) return fail('_id must be an ObjectId.')
  const form = oneOf('form', raw.form, FORMS, false)
  if (!form.ok || !form.value)
    return fail(form.ok ? 'form is required.' : form.error)

  const item: ItemFields = {
    ...ITEM_DEFAULTS,
    _id: raw._id.toLowerCase(),
    form: form.value,
  }
  for (const key of PATCH_KEYS) {
    if (!(key in raw) || raw[key] === undefined) continue
    const checked = validateField(key, raw[key])
    if (!checked.ok) return fail(checked.error, checked.status ?? 400)
    ;(item as unknown as Record<string, unknown>)[key] = checked.value
  }

  // Only the ink-bearing field can carry a pressure-less point, so normalise once here.
  if (item.ink) item.ink = { points: item.ink.points }

  // Status next to a meaning that does not track one is dropped by `data.ts`, which has the
  // vocabulary (vocab.ts `normalizeStatus`); the shape is all this module can check.
  const rule = checkFormRules(item)
  if (rule) return fail(rule)

  return { ok: true, value: item }
}

/**
 * A PATCH body: only the keys that were sent (R3-1). An absent key means "unchanged", so a
 * title edit can never carry a stale `includeInAi` back to the server.
 */
export function validateItemPatch(input: unknown): Verdict<ItemPatch> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail('Patch must be an object.')
  const raw = input as Record<string, unknown>

  if ('_id' in raw || 'form' in raw)
    return fail('_id and form cannot be changed.')

  const patch: Record<string, unknown> = {}
  for (const key of PATCH_KEYS) {
    if (!(key in raw) || raw[key] === undefined) continue
    const checked = validateField(key, raw[key])
    if (!checked.ok) return fail(checked.error, checked.status ?? 400)
    patch[key] = checked.value
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to update.')
  return { ok: true, value: patch as ItemPatch }
}

/** Re-check the form rules once a patch is merged over the stored item. */
export function checkMergedItem(item: ItemFields): string | null {
  return checkFormRules(item)
}

export interface BulkPositionUpdate {
  id: string
  x: number
  y: number
  parentId: string | null
}

/**
 * The multi-select drag body. All-or-nothing: the first bad entry rejects the whole request
 * and is named, so the client can mark that one card and re-queue the rest (R3-15).
 */
export function validateBulkUpdates(
  input: unknown
):
  | { ok: true; value: BulkPositionUpdate[] }
  | { ok: false; status: 400; error: string; index?: number; id?: string } {
  const updates = (input as { updates?: unknown } | null)?.updates
  if (!Array.isArray(updates))
    return { ok: false, status: 400, error: 'updates must be an array.' }
  if (updates.length === 0)
    return { ok: false, status: 400, error: 'updates is empty.' }
  if (updates.length > LIMITS.bulkUpdates)
    return {
      ok: false,
      status: 400,
      error: `updates is over ${LIMITS.bulkUpdates} entries.`,
    }

  const seen = new Set<string>()
  const clean: BulkPositionUpdate[] = []
  for (const [index, entry] of updates.entries()) {
    const raw = (entry ?? {}) as Record<string, unknown>
    const id = isObjectIdString(raw.id) ? raw.id.toLowerCase() : undefined
    const reject = (error: string) =>
      ({ ok: false, status: 400, error, index, id }) as const

    if (!id) return reject(`updates[${index}].id must be an ObjectId.`)
    if (seen.has(id)) return reject(`updates[${index}] repeats ${id}.`)
    seen.add(id)
    const x = finite('x', raw.x, LIMITS.coordinate)
    const y = finite('y', raw.y, LIMITS.coordinate)
    if (!x.ok || !y.ok)
      return reject(`updates[${index}]: ${!x.ok ? x.error : !y.ok && y.error}`)
    if (!(raw.parentId === null || isObjectIdString(raw.parentId)))
      return reject(`updates[${index}].parentId must be an ObjectId or null.`)
    clean.push({
      id,
      x: x.value,
      y: y.value,
      parentId: raw.parentId === null ? null : raw.parentId.toLowerCase(),
    })
  }
  return { ok: true, value: clean }
}

// MARK: Link validators

function optionalHandle(
  name: string,
  value: unknown
): FieldResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  return singleLine(name, value, 64)
}

export function validateLink(input: unknown): Verdict<LinkFields> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail('Link must be an object.')
  const raw = input as Record<string, unknown>

  if (!isObjectIdString(raw._id)) return fail('_id must be an ObjectId.')
  if (!isObjectIdString(raw.from) || !isObjectIdString(raw.to))
    return fail('from and to must be ObjectIds.')
  const from = raw.from.toLowerCase()
  const to = raw.to.toLowerCase()
  if (from === to) return fail('A link cannot point at its own item.')

  const label = singleLine('label', raw.label ?? '', LIMITS.linkLabel)
  if (!label.ok) return fail(label.error)
  const fromHandle = optionalHandle('fromHandle', raw.fromHandle)
  if (!fromHandle.ok) return fail(fromHandle.error)
  const toHandle = optionalHandle('toHandle', raw.toHandle)
  if (!toHandle.ok) return fail(toHandle.error)

  return {
    ok: true,
    value: {
      _id: raw._id.toLowerCase(),
      from,
      to,
      label: label.value.trim(),
      fromHandle: fromHandle.value,
      toHandle: toHandle.value,
    },
  }
}

/** D19: a label edit is the only change a link accepts. */
export function validateLinkPatch(input: unknown): Verdict<{ label: string }> {
  const raw = (input ?? {}) as Record<string, unknown>
  const label = singleLine('label', raw.label, LIMITS.linkLabel)
  if (!label.ok) return fail(label.error)
  return { ok: true, value: { label: label.value.trim() } }
}

// MARK: Board validators (D32)

export interface BoardFields {
  title: string
  includeInAi: boolean
}

/**
 * A board is a title and one privacy switch. The switch is the frame rule one level up: a
 * board agents cannot read hides everything on it, whatever each card says about itself.
 */
export function validateBoard(input: unknown): Verdict<BoardFields> {
  const raw = (input ?? {}) as Record<string, unknown>
  const title = singleLine('title', raw.title ?? '', LIMITS.title)
  if (!title.ok) return fail(title.error)
  if (raw.includeInAi !== undefined && typeof raw.includeInAi !== 'boolean')
    return fail('includeInAi must be a boolean.')
  return {
    ok: true,
    value: {
      title: title.value.trim(),
      includeInAi: raw.includeInAi !== false,
    },
  }
}

export function validateBoardPatch(
  input: unknown
): Verdict<Partial<BoardFields>> {
  const raw = (input ?? {}) as Record<string, unknown>
  const patch: Partial<BoardFields> = {}
  if ('title' in raw) {
    const title = singleLine('title', raw.title, LIMITS.title)
    if (!title.ok) return fail(title.error)
    patch.title = title.value.trim()
  }
  if ('includeInAi' in raw) {
    if (typeof raw.includeInAi !== 'boolean')
      return fail('includeInAi must be a boolean.')
    patch.includeInAi = raw.includeInAi
  }
  if (Object.keys(patch).length === 0) return fail('Nothing to update.')
  return { ok: true, value: patch }
}

// MARK: Backup file

export const BACKUP_VERSION = 1

export interface BackupFile {
  version: typeof BACKUP_VERSION
  exportedAt: string
  items: unknown[]
  links: unknown[]
}

/**
 * The whole-file pre-check the restore dialog runs before any batch is sent (D21).
 *
 * Every entry through the same validators the routes use, plus the cross-entry rules a
 * single batch cannot see: duplicate ids, a parent that is not a frame in the file, a link
 * whose end is not in the file. The server re-validates each batch against the database, so
 * this is the "which entry and why, zero writes" answer, not the security boundary.
 */
export function validateBackupFile(
  input: unknown
):
  | { ok: true; items: ItemFields[]; links: LinkFields[] }
  | { ok: false; error: string } {
  const raw = input as Partial<BackupFile> | null
  if (!raw || typeof raw !== 'object')
    return { ok: false, error: 'The file is not a whiteboard backup.' }
  if (raw.version !== BACKUP_VERSION)
    return {
      ok: false,
      error: `Unsupported backup version ${String(raw.version)}.`,
    }
  if (!Array.isArray(raw.items) || !Array.isArray(raw.links))
    return { ok: false, error: 'The file has no items or links arrays.' }

  const items: ItemFields[] = []
  const ids = new Set<string>()
  for (const [index, entry] of raw.items.entries()) {
    const checked = validateItem(entry)
    if (!checked.ok)
      return { ok: false, error: `items[${index}]: ${checked.error}` }
    if (ids.has(checked.value._id))
      return {
        ok: false,
        error: `items[${index}]: duplicate id ${checked.value._id}.`,
      }
    ids.add(checked.value._id)
    items.push(checked.value)
  }

  const frames = new Set(items.filter(i => i.form === 'frame').map(i => i._id))
  for (const [index, item] of items.entries())
    if (item.parentId && !frames.has(item.parentId))
      return {
        ok: false,
        error: `items[${index}]: parent ${item.parentId} is not a frame in this file.`,
      }

  const links: LinkFields[] = []
  const linkIds = new Set<string>()
  const triples = new Set<string>()
  for (const [index, entry] of raw.links.entries()) {
    const checked = validateLink(entry)
    if (!checked.ok)
      return { ok: false, error: `links[${index}]: ${checked.error}` }
    const link = checked.value
    if (linkIds.has(link._id))
      return { ok: false, error: `links[${index}]: duplicate id ${link._id}.` }
    if (!ids.has(link.from) || !ids.has(link.to))
      return {
        ok: false,
        error: `links[${index}]: an end is not an item in this file.`,
      }
    const triple = `${link.from}|${link.to}|${link.label}`
    if (triples.has(triple))
      return {
        ok: false,
        error: `links[${index}]: duplicates another link's from, to and label.`,
      }
    linkIds.add(link._id)
    triples.add(triple)
    links.push(link)
  }

  return { ok: true, items, links }
}
