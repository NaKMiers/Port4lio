'use client'

import { ArrowDownLeft, ArrowUpRight, Sparkles, Trash2, X } from 'lucide-react'
import { memo, useLayoutEffect, useRef, useState } from 'react'

import ToggleSwitch from '@/components/blog-admin/ToggleSwitch'
import SelectField from '@/components/settings/SelectField'
import {
  ghostBtnCls,
  inputCls,
  labelCls,
  secondaryBtnCls,
  textareaCls,
} from '@/components/settings/settings-utils'
import {
  readableChildren,
  skipsBulkAiOn,
} from '@/components/whiteboard/frame-geometry'
import { MeaningChip } from '@/components/whiteboard/nodes/badges'
import { ShortcutList } from '@/components/whiteboard/ShortcutsHelp'
import type { Board } from '@/components/whiteboard/useBoard'
import { cn } from '@/lib/utils'
import { LIMITS, type Meaning, type Status } from '@/lib/whiteboard/limits'
import type { ClientItem } from '@/lib/whiteboard/types'
import {
  findMeaning,
  findStatus,
  tracksStatus,
  type Vocab,
  type VocabKind,
} from '@/lib/whiteboard/vocab'
import { useVocab } from '@/components/whiteboard/vocab-context'

/**
 * The 320px inspector (a bottom sheet below lg): nothing selected, one item, several items,
 * or one link.
 *
 * ## One item (DR10)
 *
 * Title, an auto-growing Body with a live `1,240 / 20,000` counter (typing stops at the cap,
 * which is the same number the server enforces - limits.ts), Meaning and Status, the two
 * calendar-day dates, tags, the links in and out, and "Include in AI export".
 *
 * The toggle shows the item's EFFECTIVE visibility. A child of a hidden frame is hidden
 * whatever its own flag says, so its toggle is disabled with "Hidden by frame <title>"
 * rather than showing an "on" that is not true. Turning a hidden frame back on asks first
 * (D24): its children would all become agent-readable at once, so "Keep items private" is
 * offered beside "Make all readable".
 *
 * ## Several items (DR11)
 *
 * A summary by meaning, then Set meaning, Include in AI, Export selection and Delete. Bulk
 * edits fan out as one PATCH per item through each item's own queue, and report per item
 * ("4 of 5 updated - 1 not saved"). Turning AI on skips children of hidden frames and says
 * so: rule 1 still wins.
 */

export interface InspectorProps {
  board: Board
  selection: { nodes: string[]; edges: string[] }
  onDelete: () => void
  onSelect: (ids: string[]) => void
  onExportSelection: () => void
  onUnhideFrame: (frame: ClientItem, readableChildren: number) => void
  /** Open "Manage meanings / statuses" (VocabDialog). */
  onManageVocab: (kind: VocabKind) => void
  /** The board is still loading (or failed): nothing here may write (DR4). */
  readOnly?: boolean
  className?: string
}

const FORM_LABEL = {
  text: 'Text card',
  todo: 'To-do card',
  shape: 'Shape',
  frame: 'Frame',
  ink: 'Sketch',
} as const

/**
 * The owner's list as select options. A key a card still carries after it left the list is
 * kept as an option, marked, so the select shows the truth instead of snapping to the first
 * entry - and choosing anything else is how the owner moves the card off it.
 */
function meaningOptions(vocab: Vocab, current: string | null = null) {
  const options = [
    { value: '', label: 'Unclassified' },
    ...vocab.meanings.map(m => ({ value: m.key, label: m.label })),
  ]
  if (current && !findMeaning(vocab, current))
    options.push({ value: current, label: `${current} (not in the list)` })
  return options
}

function statusOptions(vocab: Vocab, current: string | null) {
  const options = [
    { value: '', label: 'None' },
    ...vocab.statuses.map(s => ({ value: s.key, label: s.label })),
  ]
  if (current && !findStatus(vocab, current))
    options.push({ value: current, label: `${current} (not in the list)` })
  return options
}

/** "Meaning" / "Status" with a Manage button beside it, like the blog editor's Kind. */
function ManagedLabel({
  htmlFor,
  label,
  kind,
  onManage,
}: {
  htmlFor: string
  label: string
  kind: VocabKind
  onManage: (kind: VocabKind) => void
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <label
        htmlFor={htmlFor}
        className={labelCls}
      >
        {label}
      </label>
      <button
        type="button"
        onClick={() => onManage(kind)}
        aria-label={kind === 'meaning' ? 'Manage meanings' : 'Manage statuses'}
        className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-pp-muted hover:text-pp-text"
      >
        Manage
      </button>
    </div>
  )
}

const deleteCls =
  'inline-flex items-center gap-2 self-start font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-ink-rose hover:underline'

function Inspector(props: InspectorProps) {
  const { board, selection, readOnly = false, className } = props
  const { data } = board
  const items = selection.nodes.map(id => data.items[id]).filter(Boolean)

  let body: React.ReactNode
  if (items.length === 0 && selection.edges.length > 0)
    body = <LinkPanel {...props} />
  else if (items.length === 0) body = <NothingSelected />
  else if (items.length === 1)
    body = (
      <ItemPanel
        key={items[0]._id}
        {...props}
        item={items[0]}
      />
    )
  else
    body = (
      <MultiPanel
        {...props}
        items={items}
      />
    )

  return (
    <aside
      aria-label="Inspector"
      className={cn('flex min-h-full flex-col gap-3.5 p-[18px]', className)}
    >
      {/* A disabled fieldset disables every control inside it at once, custom buttons too,
          so a selection left over from before a reload can't edit a partial board. */}
      <fieldset
        disabled={readOnly}
        className="contents"
      >
        {body}
      </fieldset>
    </aside>
  )
}

function NothingSelected() {
  return (
    <>
      <p className={labelCls}>Nothing selected</p>
      <p className="text-[12px] leading-relaxed text-pp-muted">
        Select a card to edit its meaning, dates, links and AI visibility.
      </p>
      <p className={cn(labelCls, 'mt-3')}>Shortcuts</p>
      <ShortcutList />
    </>
  )
}

// MARK: One item

function ItemPanel({
  board,
  item,
  onDelete,
  onSelect,
  onUnhideFrame,
  onManageVocab,
}: InspectorProps & { item: ClientItem }) {
  const { data, errors, actions } = board
  const { vocab } = useVocab()
  const id = item._id
  const parent = item.parentId ? data.items[item.parentId] : undefined
  const hiddenByFrame =
    Boolean(item.parentId) && (!parent || !parent.includeInAi)
  const statusEnabled = tracksStatus(vocab, item.meaning)

  const outgoing = Object.values(data.links).filter(l => l.from === id)
  const incoming = Object.values(data.links).filter(l => l.to === id)

  const toggleAi = (next: boolean) => {
    if (item.form === 'frame' && next && !item.includeInAi) {
      const readable = readableChildren(id, Object.values(data.items))
      if (readable > 0) {
        onUnhideFrame(item, readable)
        return
      }
    }
    actions.updateItem(id, { includeInAi: next }, { delay: 0 })
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className={cn(labelCls, 'mb-0')}>{FORM_LABEL[item.form]}</p>
        <span
          className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-pp-muted"
          title={id}
        >
          id {id.slice(0, 4)}...{id.slice(-2)}
        </span>
      </div>

      {errors[id] ? (
        <ErrorNotice
          message={errors[id]}
          onDiscard={() => actions.discard(id)}
        />
      ) : null}

      {item.form !== 'ink' ? (
        <div>
          <label
            htmlFor="wb-title"
            className={labelCls}
          >
            Title
          </label>
          <input
            id="wb-title"
            className={inputCls}
            value={item.title}
            maxLength={LIMITS.title}
            onChange={event =>
              actions.updateItem(id, {
                title: event.target.value.replace(/[\r\n]+/g, ' '),
              })
            }
          />
        </div>
      ) : null}

      {item.form !== 'ink' ? (
        <BodyField
          value={item.body}
          onChange={value => actions.updateItem(id, { body: value })}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <ManagedLabel
            htmlFor="wb-meaning"
            label="Meaning"
            kind="meaning"
            onManage={onManageVocab}
          />
          <SelectField
            id="wb-meaning"
            value={item.meaning ?? ''}
            options={meaningOptions(vocab, item.meaning)}
            onChange={value =>
              actions.updateItem(
                id,
                { meaning: (value || null) as Meaning | null },
                { delay: 0 }
              )
            }
          />
        </div>
        <div>
          <ManagedLabel
            htmlFor="wb-status"
            label="Status"
            kind="status"
            onManage={onManageVocab}
          />
          <SelectField
            id="wb-status"
            value={item.status ?? ''}
            options={statusOptions(vocab, item.status)}
            disabled={!statusEnabled}
            ariaLabel={
              statusEnabled
                ? undefined
                : 'Status (only for a meaning that has one - see Manage meanings)'
            }
            onChange={value =>
              actions.updateItem(
                id,
                { status: (value || null) as Status | null },
                { delay: 0 }
              )
            }
          />
        </div>
        <DayField
          id="wb-when"
          label="When"
          value={item.when}
          onChange={value =>
            actions.updateItem(id, { when: value }, { delay: 0 })
          }
        />
        <DayField
          id="wb-target"
          label="Target by"
          value={item.targetBy}
          onChange={value =>
            actions.updateItem(id, { targetBy: value }, { delay: 0 })
          }
        />
      </div>

      <TagsField
        tags={item.tags}
        onChange={tags => actions.updateItem(id, { tags }, { delay: 0 })}
      />

      {outgoing.length + incoming.length > 0 ? (
        <div>
          <p className={labelCls}>Links</p>
          <ul className="divide-y divide-pp-line border-y border-pp-line">
            {[
              ...outgoing.map(l => ({
                link: l,
                other: l.to,
                dir: 'out' as const,
              })),
              ...incoming.map(l => ({
                link: l,
                other: l.from,
                dir: 'in' as const,
              })),
            ].map(({ link, other, dir }) => {
              const target = data.items[other]
              const Icon = dir === 'out' ? ArrowUpRight : ArrowDownLeft
              return (
                <li key={link._id}>
                  <button
                    type="button"
                    onClick={() => onSelect([other])}
                    className="flex w-full items-center gap-2 py-1.5 text-left text-[12.5px] hover:text-pp-ink-blue"
                  >
                    <span className="inline-flex min-w-[96px] items-center gap-1 font-display text-[11px] font-semibold text-pp-muted">
                      <Icon
                        aria-label={dir === 'out' ? 'Outgoing' : 'Incoming'}
                        size={12}
                      />
                      {link.label || 'link'}
                    </span>
                    <span className="truncate">
                      {target?.title || `Untitled ${target?.form ?? 'item'}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-pp-line bg-white/80 px-3.5 py-3">
        <div>
          <p
            id="wb-ai-label"
            className="text-[13px] font-semibold text-pp-text"
          >
            Include in AI export
          </p>
          <p className="text-[11.5px] text-pp-muted">
            {hiddenByFrame
              ? `Hidden by frame ${parent?.title || 'Untitled frame'}`
              : item.includeInAi
                ? item.form === 'frame'
                  ? 'Agents can read this frame and what is inside it.'
                  : 'Agents can read this card.'
                : item.form === 'frame'
                  ? 'Everything inside is hidden from agents.'
                  : 'Hidden from agents.'}
          </p>
        </div>
        <ToggleSwitch
          id="wb-ai"
          checked={item.includeInAi && !hiddenByFrame}
          disabled={hiddenByFrame}
          onChange={toggleAi}
        />
      </div>

      <button
        type="button"
        onClick={onDelete}
        className={cn(deleteCls, 'mt-auto pt-4')}
      >
        <Trash2
          aria-hidden
          size={14}
        />
        Delete
      </button>
    </>
  )
}

/** DR10: grows with its content up to half the viewport, then scrolls. */
function BodyField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.5)}px`
  }, [value])
  const atCap = value.length >= LIMITS.body
  return (
    <div>
      <label
        htmlFor="wb-body"
        className={labelCls}
      >
        Body
      </label>
      <textarea
        id="wb-body"
        ref={ref}
        className={cn(textareaCls, 'max-h-[50dvh] resize-none overflow-y-auto')}
        value={value}
        maxLength={LIMITS.body}
        onChange={event => onChange(event.target.value)}
      />
      <p
        className={cn(
          'mt-1 text-right text-[11px] text-pp-muted',
          atCap && 'font-semibold text-pp-ink-rose'
        )}
        aria-live="polite"
      >
        {value.length.toLocaleString('en-US')} /{' '}
        {LIMITS.body.toLocaleString('en-US')}
      </p>
    </div>
  )
}

function DayField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string | null
  onChange: (value: string | null) => void
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className={labelCls}
      >
        {label}
      </label>
      <input
        id={id}
        type="date"
        className={cn(inputCls, 'px-3 py-2.5')}
        value={value ?? ''}
        onChange={event => onChange(event.target.value || null)}
      />
    </div>
  )
}

function TagsField({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const tag = draft.trim().replace(/[\r\n]+/g, ' ')
    if (!tag || tags.includes(tag) || tags.length >= LIMITS.tags) return
    onChange([...tags, tag.slice(0, LIMITS.tagLength)])
    setDraft('')
  }
  return (
    <div>
      <label
        htmlFor="wb-tags"
        className={labelCls}
      >
        Tags
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-[1.05rem] border border-pp-line bg-white/80 px-3 py-2">
        {tags.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-pp-text/5 px-1.5 py-px font-mono text-[11px] text-pp-muted"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(tags.filter(t => t !== tag))}
              // 44px hit area below lg (DR8) without making the chip itself bigger.
              className="relative before:absolute before:-inset-4 before:content-[''] hover:text-pp-text lg:before:-inset-1"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          id="wb-tags"
          value={draft}
          maxLength={LIMITS.tagLength}
          placeholder={tags.length >= LIMITS.tags ? '' : 'add...'}
          disabled={tags.length >= LIMITS.tags}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              add()
            }
            if (event.key === 'Backspace' && !draft && tags.length)
              onChange(tags.slice(0, -1))
          }}
          onBlur={add}
          className="min-w-[60px] flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-pp-muted/70"
        />
      </div>
    </div>
  )
}

// MARK: Several items (DR11)

function MultiPanel({
  board,
  items,
  onDelete,
  onExportSelection,
}: InspectorProps & { items: ClientItem[] }) {
  const { data, actions, queue } = board
  const { vocab } = useVocab()
  const counts = new Map<Meaning | null, number>()
  for (const item of items)
    counts.set(item.meaning, (counts.get(item.meaning) ?? 0) + 1)
  const meanings = [...counts.keys()]
  const mixed = meanings.length > 1
  const hiddenByFrame = (item: ClientItem) => {
    if (!item.parentId) return false
    const frame = data.items[item.parentId]
    return !frame || !frame.includeInAi
  }
  const hidden = items.filter(i => !i.includeInAi || hiddenByFrame(i)).length
  const allOn = items.every(i => i.includeInAi && !hiddenByFrame(i))

  const fanOut = (
    patch: Partial<ClientItem>,
    skip: (i: ClientItem) => boolean = () => false
  ) => {
    const group = `bulk-${Date.now()}`
    const skipped = items.filter(skip).map(i => i._id)
    queue.openGroup(group, skipped)
    for (const item of items)
      if (!skip(item)) actions.updateItem(item._id, patch, { delay: 0, group })
    queue.closeGroup(group)
  }

  return (
    <>
      <p className={labelCls}>{items.length} items selected</p>
      <div className="flex flex-wrap gap-1.5">
        {[...counts.entries()].map(([meaning, count]) => (
          <MeaningChip
            key={meaning ?? 'none'}
            meaning={meaning}
            count={count}
          />
        ))}
      </div>
      <p className="text-[12px] text-pp-muted">
        {hidden === 0
          ? `All ${items.length} are readable by agents.`
          : `${hidden} of ${items.length} are hidden from AI.`}
      </p>

      <div>
        <label
          htmlFor="wb-bulk-meaning"
          className={labelCls}
        >
          Set meaning
        </label>
        <SelectField
          id="wb-bulk-meaning"
          value={mixed ? '__mixed' : (meanings[0] ?? '')}
          options={[
            ...(mixed ? [{ value: '__mixed', label: 'Mixed' }] : []),
            ...meaningOptions(vocab, mixed ? null : (meanings[0] ?? null)),
          ]}
          onChange={value => {
            if (value === '__mixed') return
            fanOut({ meaning: (value || null) as Meaning | null })
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-pp-line bg-white/80 px-3.5 py-3">
        <div>
          <p
            id="wb-bulk-ai-label"
            className="text-[13px] font-semibold text-pp-text"
          >
            Include in AI export
          </p>
          <p className="text-[11.5px] text-pp-muted">
            Applies to all {items.length}.
          </p>
        </div>
        <ToggleSwitch
          id="wb-bulk-ai"
          checked={allOn}
          onChange={next =>
            // Turning AI on skips (and counts) children of hidden frames (rule 1) and
            // hidden frames themselves, which only un-hide through the D24 confirm.
            fanOut(
              { includeInAi: next },
              next ? item => skipsBulkAiOn(item, data.items) : undefined
            )
          }
        />
      </div>

      <button
        type="button"
        onClick={onExportSelection}
        className={cn(secondaryBtnCls, 'gap-2')}
      >
        <Sparkles
          aria-hidden
          size={14}
        />
        Export selection
      </button>

      <button
        type="button"
        onClick={onDelete}
        className={cn(deleteCls, 'mt-auto pt-4')}
      >
        <Trash2
          aria-hidden
          size={14}
        />
        Delete {items.length} items
      </button>
    </>
  )
}

// MARK: Link

function LinkPanel({ board, selection, onDelete, onSelect }: InspectorProps) {
  const { data, errors, actions } = board
  const links = selection.edges.map(id => data.links[id]).filter(Boolean)
  if (links.length !== 1)
    return (
      <>
        <p className={labelCls}>{links.length} links selected</p>
        <button
          type="button"
          onClick={onDelete}
          className={deleteCls}
        >
          <Trash2 size={14} />
          Delete {links.length} links
        </button>
      </>
    )
  const link = links[0]
  const from = data.items[link.from]
  const to = data.items[link.to]
  return (
    <>
      <p className={labelCls}>Link</p>
      {errors[link._id] ? (
        <ErrorNotice
          message={errors[link._id]}
          onDiscard={() => actions.discard(link._id)}
        />
      ) : null}
      <div>
        <label
          htmlFor="wb-link-label"
          className={labelCls}
        >
          Label
        </label>
        <input
          id="wb-link-label"
          className={inputCls}
          value={link.label}
          maxLength={LIMITS.linkLabel}
          placeholder="because, blocks, learned from..."
          onChange={event =>
            actions.updateLinkLabel(
              link._id,
              event.target.value.replace(/[\r\n]+/g, ' ')
            )
          }
        />
      </div>
      <div className="space-y-1 text-[12.5px]">
        {[
          ['From', from, link.from],
          ['To', to, link.to],
        ].map(([label, item, id]) => (
          <button
            key={label as string}
            type="button"
            onClick={() => onSelect([id as string])}
            className="flex w-full gap-2 text-left hover:text-pp-ink-blue"
          >
            <span className="w-10 font-display text-[11px] font-semibold text-pp-muted">
              {label as string}
            </span>
            <span className="truncate">
              {(item as ClientItem | undefined)?.title || 'Untitled'}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className={cn(deleteCls, 'mt-auto pt-4')}
      >
        <Trash2 size={14} />
        Delete link
      </button>
    </>
  )
}

export function ErrorNotice({
  message,
  onDiscard,
  className,
}: {
  message: string
  onDiscard: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-2xl border border-pp-ink-rose/30 bg-pp-pink/10 px-3 py-2.5 text-[12.5px] text-pp-ink-rose',
        className
      )}
    >
      <p className="font-semibold">Not saved</p>
      <p className="mt-0.5">{message}</p>
      <button
        type="button"
        onClick={onDiscard}
        className={cn(ghostBtnCls, 'mt-1.5 px-0 text-pp-ink-rose')}
      >
        Discard the change
      </button>
    </div>
  )
}

export default memo(Inspector)
