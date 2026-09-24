'use client'

import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  ghostBtnCls,
  helpTextCls,
  inputCls,
  primaryBtnCls,
} from '@/components/settings/settings-utils'
import {
  ICONS,
  TONE_CLS,
  TONE_LABEL,
} from '@/components/whiteboard/meaning-style'
import { MeaningChip } from '@/components/whiteboard/nodes/badges'
import { useVocab } from '@/components/whiteboard/vocab-context'
import { cn } from '@/lib/utils'
import {
  VOCAB_ICONS,
  VOCAB_LIMITS,
  VOCAB_TONES,
  keyFromLabel,
  type VocabIcon,
  type VocabKind,
  type VocabMeaning,
  type VocabTone,
} from '@/lib/whiteboard/vocab'
import {
  createVocabApi,
  deleteVocabApi,
  updateVocabApi,
  type VocabSnapshot,
} from '@/requests/whiteboard'

/**
 * Manage meanings and statuses: create, relabel, recolour, reorder, delete. One list for
 * every board (lib/whiteboard/vocab.ts). Opened from "Manage" beside Meaning or Status in the
 * inspector, on the tab it was opened from - the blog editor's Kind / Series "Manage", in a
 * whiteboard's clothes.
 *
 * ```
 *   GET    /api/admin/whiteboard/vocab                  the list + cards per key (on open)
 *   POST   /api/admin/whiteboard/vocab                  create; the key is set once, here
 *   PATCH  /api/admin/whiteboard/vocab/<kind>/<key>     label, tone, icon, has-status, or { to }
 *   DELETE /api/admin/whiteboard/vocab/<kind>/<key>     409 with the count while cards use it
 * ```
 *
 * Every answer is the whole new list, and it goes straight into the shared context, so the
 * chips on the canvas change with the dialog still open. No optimistic guess: the server
 * decides the key, the order and the refusals, and the list is a dozen rows.
 *
 * ## Why every row is collapsed
 *
 * ```
 *   [GOAL chip]            3 cards  v     one line per entry: what it looks like, how used
 *     └ open ─▶ label · colour · icon · has a status · key · move · delete
 *   + New meaning                         label and colour; the rest is set on the row after
 * ```
 *
 * Every field for every entry at once was a wall of swatches and icon grids around the one
 * thing the owner came to do. Only one row is open at a time, and the list itself is the
 * preview: each chip renders exactly as it will on a card.
 *
 * Label fields save on blur, not per keystroke - the same reason as the blog dialog: a save
 * answers a new list, and re-rendering the row mid-word would fight the typing.
 */

/** `openKey` for the "New ..." row; not a valid key, so it can never collide with one. */
const NEW = '+new'

const TABS: { kind: VocabKind; label: string }[] = [
  { kind: 'meaning', label: 'Meanings' },
  { kind: 'status', label: 'Statuses' },
]

function ToneChoice({
  value,
  onChange,
  name,
}: {
  value: VocabTone
  onChange: (tone: VocabTone) => void
  name: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Colour for ${name}`}
      className="flex flex-wrap gap-1.5"
    >
      {VOCAB_TONES.map(tone => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={value === tone}
          aria-label={TONE_LABEL[tone]}
          title={TONE_LABEL[tone]}
          onClick={() => onChange(tone)}
          className={cn(
            'h-7 w-7 rounded-full border-2',
            TONE_CLS[tone],
            value === tone
              ? 'ring-2 ring-pp-text ring-offset-2 ring-offset-white'
              : ''
          )}
        />
      ))}
    </div>
  )
}

function IconChoice({
  value,
  onChange,
  name,
}: {
  value: VocabIcon | null
  onChange: (icon: VocabIcon | null) => void
  name: string
}) {
  const choices: (VocabIcon | null)[] = [null, ...VOCAB_ICONS]
  return (
    <div
      role="radiogroup"
      aria-label={`Icon for ${name}`}
      className="flex flex-wrap gap-1"
    >
      {choices.map(icon => {
        const Icon = icon ? ICONS[icon] : null
        return (
          <button
            key={icon ?? 'none'}
            type="button"
            role="radio"
            aria-checked={value === icon}
            aria-label={icon ?? 'No icon'}
            title={icon ?? 'No icon'}
            onClick={() => onChange(icon)}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-lg border text-pp-muted',
              value === icon
                ? 'border-pp-text bg-pp-text text-white'
                : 'border-pp-line bg-white/80 hover:text-pp-text'
            )}
          >
            {Icon ? (
              <Icon
                aria-hidden
                size={14}
              />
            ) : (
              <span className="text-[11px]">-</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function VocabDialog({
  kind,
  onClose,
}: {
  /** The tab to open on; `null` is closed. */
  kind: VocabKind | null
  onClose: () => void
}) {
  const { vocab, usage, setSnapshot, reload, loaded } = useVocab()
  const [tab, setTab] = useState<VocabKind>(kind ?? 'meaning')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The one row that is open: an entry's key, `NEW` for the add row, or none. */
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newKey, setNewKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [newTone, setNewTone] = useState<VocabTone>('slate')

  // Fresh counts every time it opens: cards change between one open and the next.
  useEffect(() => {
    if (kind) void reload()
  }, [kind, reload])

  useEffect(() => {
    if (!kind) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [kind, onClose])

  if (!kind) return null

  const entries = tab === 'meaning' ? vocab.meanings : vocab.statuses
  const counts = tab === 'meaning' ? usage?.meanings : usage?.statuses
  const noun = tab === 'meaning' ? 'meaning' : 'status'

  const run = async (fn: () => Promise<VocabSnapshot>) => {
    setBusy(true)
    setError(null)
    try {
      setSnapshot(await fn())
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work')
      return false
    } finally {
      setBusy(false)
    }
  }

  const resetNew = () => {
    setNewLabel('')
    setNewKey('')
    setKeyTouched(false)
    setNewTone('slate')
  }

  const toggle = (key: string) => {
    setError(null)
    setOpenKey(current => (current === key ? null : key))
  }

  const create = async () => {
    const ok = await run(() =>
      createVocabApi(tab, {
        label: newLabel.trim(),
        // Untouched, the server makes the key from the label - the same rule as the hint.
        key: keyTouched ? newKey.trim() : undefined,
        ...(tab === 'meaning' ? { tone: newTone } : {}),
      })
    )
    if (ok) {
      resetNew()
      setOpenKey(null)
    }
  }

  const update = (key: string, changes: Record<string, unknown>) =>
    run(() => updateVocabApi(tab, key, changes))

  const suggestedKey = keyFromLabel(newLabel)
  const shownKey = keyTouched ? newKey : suggestedKey

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(31,28,26,0.35)] p-4 backdrop-blur-sm sm:p-8"
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/* `my-auto`, not `items-center`: centred while it fits, and a row opened past the
          viewport's height scrolls from its top instead of being cut off above it. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vocab-dialog-title"
        data-testid="wb-vocab-dialog"
        className="my-auto w-full max-w-md rounded-[1.5rem] border border-pp-line bg-[rgba(255,253,250,0.99)] p-5 shadow-[0_32px_64px_rgba(46,35,28,0.28)]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="vocab-dialog-title"
            className="font-display text-lg font-semibold tracking-tight text-pp-text"
          >
            Meanings and statuses
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-pp-muted transition hover:bg-pp-text/5 hover:text-pp-text"
          >
            <X
              aria-hidden
              size={16}
            />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="List"
            className="inline-flex rounded-full border border-pp-line p-0.5 text-[12px]"
          >
            {TABS.map(entry => (
              <button
                key={entry.kind}
                type="button"
                role="tab"
                aria-selected={tab === entry.kind}
                onClick={() => {
                  setTab(entry.kind)
                  setError(null)
                  setOpenKey(null)
                  resetNew()
                }}
                className={cn(
                  'rounded-full px-3 py-1 font-semibold',
                  tab === entry.kind ? 'bg-pp-text text-white' : 'text-pp-muted'
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-pp-muted">Shared by every board</p>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-[rgba(211,108,105,0.1)] px-3 py-2 text-[12.5px] text-[#7f2f2f]"
          >
            {error}
          </p>
        ) : null}

        <ul
          role="tabpanel"
          className="mt-3 divide-y divide-pp-line overflow-hidden rounded-2xl border border-pp-line bg-white/80"
        >
          {!loaded ? (
            <li className={cn(helpTextCls, 'px-3.5 py-3')}>Loading...</li>
          ) : null}

          {entries.map((entry, index) => {
            const used = counts?.[entry.key] ?? 0
            const meaning = tab === 'meaning' ? (entry as VocabMeaning) : null
            const open = openKey === entry.key
            return (
              <li
                key={entry.key}
                data-testid="wb-vocab-row"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(entry.key)}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-pp-text/[0.03]"
                >
                  {meaning ? (
                    <MeaningChip meaning={meaning.key} />
                  ) : (
                    <span className="text-[13px] font-semibold text-pp-text">
                      {entry.label}
                    </span>
                  )}
                  <span className="ml-auto text-[11.5px] text-pp-muted">
                    {used} card{used === 1 ? '' : 's'}
                  </span>
                  <ChevronDown
                    aria-hidden
                    size={14}
                    className={cn(
                      'text-pp-muted transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </button>

                {open ? (
                  <div className="space-y-3 border-t border-pp-line bg-pp-text/[0.02] px-3.5 py-3">
                    <input
                      // Remounts on a new label from the server, so the field shows it.
                      key={entry.label}
                      className={inputCls}
                      defaultValue={entry.label}
                      maxLength={VOCAB_LIMITS.label}
                      aria-label={`Label for ${entry.key}`}
                      onBlur={event => {
                        const next = event.target.value.trim()
                        if (next && next !== entry.label)
                          void update(entry.key, { label: next })
                      }}
                    />
                    {meaning ? (
                      <>
                        <ToneChoice
                          name={meaning.label}
                          value={meaning.tone}
                          onChange={tone => void update(meaning.key, { tone })}
                        />
                        <IconChoice
                          name={meaning.label}
                          value={meaning.icon}
                          onChange={icon => void update(meaning.key, { icon })}
                        />
                        <label className="flex items-center gap-2 text-[12.5px] text-pp-muted">
                          <input
                            type="checkbox"
                            checked={meaning.tracksStatus}
                            disabled={busy}
                            onChange={event =>
                              void update(meaning.key, {
                                tracksStatus: event.target.checked,
                              })
                            }
                          />
                          Has a status
                        </label>
                      </>
                    ) : null}
                    <div className="flex items-center gap-1">
                      <code
                        className="mr-auto text-[11px] text-pp-muted"
                        title="Permanent - cards store it"
                      >
                        key: {entry.key}
                      </code>
                      <button
                        type="button"
                        className={ghostBtnCls}
                        disabled={busy || index === 0}
                        aria-label={`Move ${entry.label} up`}
                        onClick={() =>
                          void update(entry.key, { to: index - 1 })
                        }
                      >
                        <ChevronUp
                          aria-hidden
                          size={14}
                        />
                      </button>
                      <button
                        type="button"
                        className={ghostBtnCls}
                        disabled={busy || index === entries.length - 1}
                        aria-label={`Move ${entry.label} down`}
                        onClick={() =>
                          void update(entry.key, { to: index + 1 })
                        }
                      >
                        <ChevronDown
                          aria-hidden
                          size={14}
                        />
                      </button>
                      <button
                        type="button"
                        className={cn(ghostBtnCls, 'hover:text-pp-ink-rose')}
                        disabled={busy}
                        aria-label={`Delete ${entry.label}`}
                        title={
                          used > 0
                            ? 'Cards still use this - give them another first'
                            : 'Delete'
                        }
                        onClick={() =>
                          void run(() => deleteVocabApi(tab, entry.key))
                        }
                      >
                        <Trash2
                          aria-hidden
                          size={14}
                        />
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}

          <li>
            <button
              type="button"
              aria-expanded={openKey === NEW}
              onClick={() => toggle(NEW)}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-pp-muted hover:bg-pp-text/[0.03] hover:text-pp-text"
            >
              <Plus
                aria-hidden
                size={14}
              />
              New {noun}
            </button>
            {openKey === NEW ? (
              <form
                className="space-y-3 border-t border-pp-line bg-pp-text/[0.02] px-3.5 py-3"
                onSubmit={event => {
                  event.preventDefault()
                  void create()
                }}
              >
                <input
                  className={inputCls}
                  value={newLabel}
                  maxLength={VOCAB_LIMITS.label}
                  aria-label="Label"
                  autoFocus
                  onChange={event => setNewLabel(event.target.value)}
                  placeholder={tab === 'meaning' ? 'e.g. Idea' : 'e.g. Blocked'}
                />
                {tab === 'meaning' ? (
                  <ToneChoice
                    name="the new meaning"
                    value={newTone}
                    onChange={setNewTone}
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-pp-muted">
                    key
                    <input
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] text-pp-text hover:border-pp-line focus:border-pp-line"
                      value={shownKey}
                      maxLength={VOCAB_LIMITS.key}
                      aria-label="Key"
                      title="Made from the label. Permanent once added - cards store it."
                      placeholder="made from the label"
                      onChange={event => {
                        setKeyTouched(true)
                        setNewKey(event.target.value.toLowerCase())
                      }}
                    />
                  </label>
                  <button
                    type="submit"
                    className={cn(primaryBtnCls, 'px-3.5 py-1.5 text-xs')}
                    disabled={busy || !newLabel.trim() || !shownKey}
                  >
                    Add {noun}
                  </button>
                </div>
              </form>
            ) : null}
          </li>
        </ul>
      </div>
    </div>
  )
}
