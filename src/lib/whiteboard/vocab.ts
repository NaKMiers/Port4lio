import { VOCAB_KEY_PATTERN } from '@/lib/whiteboard/limits'

/**
 * The whiteboard's vocabulary: the meanings a card can carry and the statuses a meaning can
 * track. Owner-editable (the "Manage" dialog in the inspector), one list for every board.
 * Pure and importable from the browser, like `limits.ts`.
 *
 * ```
 *   WhiteboardVocab (one document, _id 'vocab')      vocab-service.ts   read / create / edit
 *        │ seeded with DEFAULT_VOCAB on first read                      / reorder / delete
 *        ▼
 *   data.ts ──▶ checkVocab: every item write names a meaning and status that exist
 *   context.ts ─▶ headings, order and "active" priority come from it
 *   canvas ─────▶ chips, inspector options, export filters (meaning-style.ts for colour)
 * ```
 *
 * ## Why the key is frozen and the label is not
 *
 * An item stores the KEY (`goal`), so renaming "Goal" to "Objective" is a label edit that
 * touches no card. Changing a key would mean rewriting every item that carries it, across
 * boards, with no transaction around it - the same reason a blog kind's slug is permanent.
 *
 * ## Why a delete is refused while a card uses the entry
 *
 * Deleting "goal" out from under 40 cards would leave them naming nothing: the chip would
 * fall back to the raw key and agents would read a meaning that is not in the list. The
 * refusal carries the count, so it is also the worklist (reassign them, then delete).
 *
 * ## Why only one document
 *
 * The list is a handful of rows, read on every item write and every export. One document
 * makes that one indexed read, keeps the order as plain array order, and lets every change be
 * a conditional write on `updatedAt` (vocab-service.ts), so two tabs editing the list cannot
 * silently drop each other's rows.
 */

export const VOCAB_KINDS = ['meaning', 'status'] as const
export type VocabKind = (typeof VOCAB_KINDS)[number]

/** Colour tones a meaning may take; the classes live in `meaning-style.ts`. */
export const VOCAB_TONES = [
  'blue',
  'violet',
  'amber',
  'rose',
  'green',
  'slate',
] as const
export type VocabTone = (typeof VOCAB_TONES)[number]

/** Icons a meaning may take; the components live in `meaning-style.ts`. */
export const VOCAB_ICONS = [
  'target',
  'moon',
  'alert',
  'pen',
  'note',
  'star',
  'flag',
  'bulb',
  'heart',
  'bookmark',
] as const
export type VocabIcon = (typeof VOCAB_ICONS)[number]

export interface VocabMeaning {
  key: string
  label: string
  tone: VocabTone
  icon: VocabIcon | null
  /** Items with this meaning can carry a status (dreams and goals, by default). */
  tracksStatus: boolean
}

export interface VocabStatus {
  key: string
  label: string
}

export interface Vocab {
  meanings: VocabMeaning[]
  statuses: VocabStatus[]
}

export const VOCAB_LIMITS = {
  entries: 30,
  label: 40,
  key: 32,
} as const

/** Lives in `limits.ts`, which validates items and must import nothing (its own test). */
export { VOCAB_KEY_PATTERN }

/** The board's original, fixed list. A fresh install starts from it; after that it is data. */
export const DEFAULT_VOCAB: Vocab = {
  meanings: [
    {
      key: 'dream',
      label: 'Dream',
      tone: 'violet',
      icon: 'moon',
      tracksStatus: true,
    },
    {
      key: 'goal',
      label: 'Goal',
      tone: 'blue',
      icon: 'target',
      tracksStatus: true,
    },
    {
      key: 'failure',
      label: 'Failure',
      tone: 'amber',
      icon: 'alert',
      tracksStatus: false,
    },
    {
      key: 'draft',
      label: 'Draft',
      tone: 'rose',
      icon: 'pen',
      tracksStatus: false,
    },
    {
      key: 'note',
      label: 'Note',
      tone: 'green',
      icon: 'note',
      tracksStatus: false,
    },
  ],
  statuses: [
    { key: 'active', label: 'Active' },
    { key: 'someday', label: 'Someday' },
    { key: 'done', label: 'Done' },
    { key: 'dropped', label: 'Dropped' },
  ],
}

/** The status that puts an item at the front of an export (and in "Active" on the overview). */
export const PRIORITY_STATUS = 'active'

export function findMeaning(
  vocab: Vocab,
  key: string | null
): VocabMeaning | undefined {
  return key ? vocab.meanings.find(entry => entry.key === key) : undefined
}

export function findStatus(
  vocab: Vocab,
  key: string | null
): VocabStatus | undefined {
  return key ? vocab.statuses.find(entry => entry.key === key) : undefined
}

export function tracksStatus(vocab: Vocab, meaning: string | null): boolean {
  return Boolean(findMeaning(vocab, meaning)?.tracksStatus)
}

/** `status` survives only next to a meaning that tracks one. Anywhere else it is `null`. */
export function normalizeStatus(
  vocab: Vocab,
  meaning: string | null,
  status: string | null
): string | null {
  return tracksStatus(vocab, meaning) ? status : null
}

/**
 * Does this pair name entries that exist? `null` means yes. The message lists the keys, so a
 * refusal an agent gets back says how to fix the call.
 */
export function checkVocab(
  vocab: Vocab,
  meaning: string | null,
  status: string | null
): string | null {
  if (meaning && !findMeaning(vocab, meaning))
    return `meaning must be one of ${vocab.meanings.map(m => m.key).join(', ') || '(none defined)'}, or null.`
  if (status && !findStatus(vocab, status))
    return `status must be one of ${vocab.statuses.map(s => s.key).join(', ') || '(none defined)'}, or null.`
  return null
}

/** A key from a label: "Side project" -> "side-project". Empty when nothing usable is left. */
export function keyFromLabel(label: string): string {
  const key = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, VOCAB_LIMITS.key)
    .replace(/-+$/, '')
  return VOCAB_KEY_PATTERN.test(key) ? key : ''
}

// MARK: Edits (pure, so the service's conditional write and the tests share one rule set)

export type VocabEdit =
  | {
      type: 'create'
      kind: VocabKind
      entry: Partial<VocabMeaning> & { key?: unknown; label?: unknown }
    }
  | {
      type: 'update'
      kind: VocabKind
      key: string
      changes: Record<string, unknown>
    }
  | { type: 'move'; kind: VocabKind; key: string; to: number }
  | { type: 'delete'; kind: VocabKind; key: string }

export type VocabEditResult =
  | { ok: true; vocab: Vocab }
  | { ok: false; status: 400 | 404 | 409; error: string }

const bad = (error: string, status: 400 | 404 | 409 = 400) =>
  ({ ok: false, status, error }) as const

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const label = value.replace(/\s+/g, ' ').trim()
  return label && label.length <= VOCAB_LIMITS.label ? label : null
}

function cleanTone(value: unknown): VocabTone | null {
  return typeof value === 'string' &&
    (VOCAB_TONES as readonly string[]).includes(value)
    ? (value as VocabTone)
    : null
}

function cleanIcon(value: unknown): VocabIcon | null | undefined {
  if (value === null) return null
  return typeof value === 'string' &&
    (VOCAB_ICONS as readonly string[]).includes(value)
    ? (value as VocabIcon)
    : undefined
}

/**
 * Apply one edit to a list. Usage rules that need the items (in use, a status still set) are
 * the service's; this answers "is the edit well-formed and consistent with the list".
 */
export function applyVocabEdit(vocab: Vocab, edit: VocabEdit): VocabEditResult {
  const list =
    edit.kind === 'meaning'
      ? vocab.meanings
      : (vocab.statuses as VocabMeaning[])
  const put = (next: VocabMeaning[] | VocabStatus[]): VocabEditResult => ({
    ok: true,
    vocab:
      edit.kind === 'meaning'
        ? { ...vocab, meanings: next as VocabMeaning[] }
        : { ...vocab, statuses: next as VocabStatus[] },
  })
  const noun = edit.kind === 'meaning' ? 'Meaning' : 'Status'

  if (edit.type === 'create') {
    const label = cleanLabel(edit.entry.label)
    if (!label)
      return bad(
        `A ${edit.kind} needs a label of 1-${VOCAB_LIMITS.label} characters.`
      )
    const key =
      typeof edit.entry.key === 'string' && edit.entry.key.trim()
        ? edit.entry.key.trim()
        : keyFromLabel(label)
    if (!VOCAB_KEY_PATTERN.test(key))
      return bad(
        'The key must start with a letter and use only a-z, 0-9 and hyphens (up to 32).'
      )
    if (list.some(entry => entry.key === key))
      return bad(`${noun} "${key}" already exists.`, 409)
    if (list.length >= VOCAB_LIMITS.entries)
      return bad(`At most ${VOCAB_LIMITS.entries} ${edit.kind} entries.`, 409)
    if (edit.kind === 'status') return put([...vocab.statuses, { key, label }])
    const icon = cleanIcon(edit.entry.icon ?? null)
    return put([
      ...vocab.meanings,
      {
        key,
        label,
        tone: cleanTone(edit.entry.tone) ?? 'slate',
        icon: icon === undefined ? null : icon,
        tracksStatus: edit.entry.tracksStatus === true,
      },
    ])
  }

  const index = list.findIndex(entry => entry.key === edit.key)
  if (index < 0) return bad(`${noun} "${edit.key}" not found.`, 404)

  if (edit.type === 'delete')
    return put(list.filter(entry => entry.key !== edit.key))

  if (edit.type === 'move') {
    if (!Number.isInteger(edit.to)) return bad('to must be a whole number.')
    const to = Math.max(0, Math.min(list.length - 1, edit.to))
    const next = [...list]
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    return put(next)
  }

  const current = list[index]
  const changes = edit.changes
  if ('key' in changes && changes.key !== current.key)
    return bad(
      'A key is permanent - items store it. Create a new entry, move the items, then delete this one.'
    )
  const next: VocabMeaning = { ...(current as VocabMeaning) }
  if ('label' in changes) {
    const label = cleanLabel(changes.label)
    if (!label)
      return bad(`The label must be 1-${VOCAB_LIMITS.label} characters.`)
    next.label = label
  }
  if (edit.kind === 'meaning') {
    if ('tone' in changes) {
      const tone = cleanTone(changes.tone)
      if (!tone) return bad(`tone must be one of ${VOCAB_TONES.join(', ')}.`)
      next.tone = tone
    }
    if ('icon' in changes) {
      const icon = cleanIcon(changes.icon)
      if (icon === undefined)
        return bad(`icon must be one of ${VOCAB_ICONS.join(', ')}, or null.`)
      next.icon = icon
    }
    if ('tracksStatus' in changes) {
      if (typeof changes.tracksStatus !== 'boolean')
        return bad('tracksStatus must be a boolean.')
      next.tracksStatus = changes.tracksStatus
    }
  }
  const updated: (VocabMeaning | VocabStatus)[] = [...list]
  updated[index] =
    edit.kind === 'meaning' ? next : { key: next.key, label: next.label }
  return put(updated as VocabMeaning[] | VocabStatus[])
}
