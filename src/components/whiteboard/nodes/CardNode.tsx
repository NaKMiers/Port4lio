'use client'

import { NodeResizeControl, type Node, type NodeProps } from '@xyflow/react'
import { Check, Plus, X } from 'lucide-react'
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

import { useBoardUi, type ItemNodeData } from '@/components/whiteboard/board-ui'
import NodeHandles from '@/components/whiteboard/nodes/NodeHandles'
import {
  ErrorBadge,
  HiddenBadge,
  MeaningChip,
} from '@/components/whiteboard/nodes/badges'
import { cn } from '@/lib/utils'
import { LIMITS, type TodoRow } from '@/lib/whiteboard/limits'

/**
 * A text or to-do card (DR7, DR10).
 *
 * ```
 *   [GOAL] ACTIVE · BY 2027-06          chip + meta
 *   Publish on the blog every week      title (Montserrat 600)
 *   One post a week for a year, ...     body, clamped at 6 lines, then "... more"
 *   `writing` `career`                  tags
 * ```
 *
 * Double-click or Enter edits the title and body in place; Escape or a click outside
 * commits. Every keystroke goes through the same `updateItem` the inspector uses, so the
 * two can never show different text - the queue's ~600 ms debounce is what keeps that from
 * being a request per key.
 *
 * ## Size
 *
 * ```
 *   right edge    width, 160-480                 the text rewraps
 *   bottom edge   height, a FLOOR not a box      the card still grows with its text
 *   corner        both
 * ```
 *
 * The stored height is a min-height: a card is never shorter than its text, so dragging
 * the bottom edge up past the text snaps back to it rather than cutting a to-do row off.
 * Room the owner adds goes to the body - `useBodyLines` lifts the 6-line clamp to however
 * many lines fit - so a taller card shows more of its text instead of blank paper.
 *
 * Editing never changes the size. The card is held at the height it had a moment before
 * (`useRestingHeight`), and the body field takes whatever room is left and scrolls inside it.
 * It used to grow to fit the whole body, up to 320 px, so a double-click pushed the card
 * down over whatever sat below it.
 */

type CardNode = Node<ItemNodeData, 'card'>

const BODY_CLAMP_LINES = 6

/*
  Type sizes, in canvas pixels. A board is usually read zoomed out to 50-60%, where the
  original 13.5px body came out near 7px on screen and grey on cream. These are what stays
  legible there: 18px titles, 15.5px body in near-text colour, 11.5px chips and meta.
  `compose-layout.ts` predicts card heights from the same numbers (its CARD table) - change
  them together, or composed boards overlap.
*/
const CHIP_CLS = 'px-2.5 py-1 text-[11.5px] [&>svg]:h-[13px] [&>svg]:w-[13px]'
// The card's text is in `div`s, never `p`: `.portfolio-public-root p` (globals.css) outranks
// a utility class and forced every paragraph here to the muted grey at line-height 1.75 - a
// 27px line that spread six lines of body over 163px, and kept this colour from applying.
const BODY_TEXT_CLS = 'text-pp-text/75 leading-[1.45]'
const MIN_HEIGHT = 60
const MAX_HEIGHT = 960

function formatMonth(day: string | null) {
  return day ? day.slice(0, 7) : null
}

function CardNodeView({ id, data, selected }: NodeProps<CardNode>) {
  const { item, hidden, hiddenByFrame, error } = data
  const ui = useBoardUi()
  const editing = ui.editingId === id
  const readOnly = ui.readOnly

  // Mid-resize, the live height; otherwise the stored floor. Not React Flow's `height` prop:
  // that is the measured size (0 before the first measure), so the stored height was never
  // applied and a resized card fell back to its text height on the next load.
  const minHeight = data.liveHeight ?? item.height
  const rootRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const bodyLines = useBodyLines(rootRef, contentRef, bodyRef, minHeight)
  const resting = useRestingHeight(rootRef, editing)
  const held = editing && resting !== null

  const meta = [
    item.status,
    item.targetBy ? `by ${formatMonth(item.targetBy)}` : null,
    item.when && !item.targetBy ? `when ${formatMonth(item.when)}` : null,
  ].filter(Boolean)

  const done = item.todos.filter(row => row.done).length

  return (
    <div
      ref={rootRef}
      data-testid="wb-card"
      data-item-id={id}
      data-hidden={hidden || undefined}
      style={{ minHeight, height: held ? resting : undefined }}
      className={cn(
        'wb-card group/card relative h-full w-full rounded-2xl border border-pp-line bg-pp-panel-strong px-[15px] py-3.5 text-[15.5px] leading-snug text-pp-text shadow-[0_14px_30px_rgba(46,35,28,0.08)]',
        held && 'flex flex-col overflow-hidden',
        hiddenByFrame && 'opacity-55',
        selected && 'ring-2 ring-pp-ink-blue ring-offset-2 ring-offset-pp-bg',
        error && 'ring-2 ring-pp-ink-rose ring-offset-2 ring-offset-pp-bg',
        data.pulse && hidden && 'wb-pulse'
      )}
    >
      <NodeHandles />
      {selected && !readOnly ? (
        <>
          <NodeResizeControl
            position="right"
            resizeDirection="horizontal"
            minWidth={160}
            maxWidth={480}
            className="wb-resize-x"
            onResizeEnd={(_event, params) =>
              ui.actions.updateItem(
                id,
                { width: Math.round(params.width), x: params.x, y: params.y },
                { delay: 0 }
              )
            }
          />
          <NodeResizeControl
            position="bottom"
            resizeDirection="vertical"
            minHeight={MIN_HEIGHT}
            maxHeight={MAX_HEIGHT}
            className="wb-resize-y"
            onResizeEnd={(_event, params) =>
              ui.actions.updateItem(
                id,
                { height: Math.round(params.height), x: params.x, y: params.y },
                { delay: 0 }
              )
            }
          />
          <NodeResizeControl
            position="bottom-right"
            minWidth={160}
            maxWidth={480}
            minHeight={MIN_HEIGHT}
            maxHeight={MAX_HEIGHT}
            className="wb-resize-handle"
            onResizeEnd={(_event, params) =>
              ui.actions.updateItem(
                id,
                {
                  width: Math.round(params.width),
                  height: Math.round(params.height),
                  x: params.x,
                  y: params.y,
                },
                { delay: 0 }
              )
            }
          />
        </>
      ) : null}
      {hidden ? <HiddenBadge className="absolute right-2.5 top-2.5" /> : null}
      {error ? <ErrorBadge message={error} /> : null}

      <div
        ref={contentRef}
        className={cn(held && 'flex min-h-0 flex-1 flex-col')}
      >
        <div className="flex min-h-[24px] items-center gap-2 pr-5">
          <MeaningChip
            meaning={item.meaning}
            className={CHIP_CLS}
          />
          {meta.length ? (
            <span className="truncate font-display text-[11.5px] font-semibold uppercase tracking-[0.1em] text-pp-muted">
              {meta.join(' · ')}
            </span>
          ) : null}
        </div>

        {editing ? (
          <InlineEditor
            id={id}
            title={item.title}
            body={item.body}
            showBody={item.form === 'text'}
          />
        ) : (
          <>
            <h4
              className={cn(
                'mb-1.5 mt-2.5 break-words font-display text-[18px] font-semibold leading-[1.3] tracking-[-0.01em]',
                !item.title && 'text-pp-muted/70'
              )}
            >
              {item.title ||
                (item.form === 'todo' ? 'Untitled list' : 'Untitled card')}
            </h4>
            {item.form === 'text' && item.body ? (
              <ClampedBody
                body={item.body}
                lines={bodyLines}
                textRef={bodyRef}
                onMore={() => ui.focusBody(id)}
              />
            ) : null}
          </>
        )}

        {item.form === 'todo' ? (
          <TodoRows
            id={id}
            rows={item.todos}
            editable={!readOnly && (selected || editing)}
          />
        ) : null}
        {item.form === 'todo' && item.todos.length ? (
          <div className="mt-2 text-[13px] leading-snug text-pp-muted">
            {done} of {item.todos.length} done
          </div>
        ) : null}

        {item.tags.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tags.map(tag => (
              <span
                key={tag}
                className="rounded-md bg-pp-text/5 px-2 py-0.5 font-mono text-[12.5px] text-pp-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {!editing &&
        !meta.length &&
        !item.when &&
        item.form === 'text' &&
        !item.body ? (
          <div className="mt-1 text-[12.5px] leading-snug text-pp-muted">
            created {item.createdAt.slice(0, 10)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * How many body lines the card shows: never fewer than BODY_CLAMP_LINES, and more when the
 * card's height floor leaves spare room below the text.
 *
 * ```
 *   spare = minHeight - (padding + border) - content height
 *   spare < 0            the text is taller than asked   drop lines, down to 6
 *   spare >= 1 line      and the body is still clamped   add floor(spare / line) lines
 * ```
 *
 * It re-runs whenever the content resizes, so it settles in a step or two: once the body
 * is no longer clamped there is nothing more to show and it stops adding.
 */
function useBodyLines(
  rootRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  bodyRef: RefObject<HTMLDivElement | null>,
  minHeight: number
) {
  const [lines, setLines] = useState(BODY_CLAMP_LINES)

  useLayoutEffect(() => {
    const root = rootRef.current
    const content = contentRef.current
    if (!root || !content) return

    const fit = () => {
      const body = bodyRef.current
      if (!body) return
      const lineHeight = parseFloat(getComputedStyle(body).lineHeight)
      if (!lineHeight) return
      const style = getComputedStyle(root)
      const chrome =
        root.offsetHeight -
        root.clientHeight +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom)
      const spare = minHeight - chrome - content.offsetHeight
      const clamped = body.scrollHeight > body.clientHeight + 1
      setLines(current => {
        if (spare < -1)
          return Math.max(
            BODY_CLAMP_LINES,
            current - Math.ceil(-spare / lineHeight)
          )
        if (clamped && spare >= lineHeight)
          return current + Math.floor(spare / lineHeight)
        return current
      })
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(content)
    return () => observer.disconnect()
  }, [bodyRef, contentRef, minHeight, rootRef])

  return lines
}

/**
 * The card's height while it is not being edited, frozen the moment editing starts. Read by
 * an observer rather than during render, and the observer is gone before the editor lays
 * out, so the editor can never feed its own size back into the height it is held to.
 */
function useRestingHeight(
  rootRef: RefObject<HTMLDivElement | null>,
  editing: boolean
) {
  const [resting, setResting] = useState<number | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || editing) return
    const observer = new ResizeObserver(() => setResting(root.offsetHeight))
    observer.observe(root)
    return () => observer.disconnect()
  }, [editing, rootRef])

  return resting
}

function ClampedBody({
  body,
  lines,
  textRef,
  onMore,
}: {
  body: string
  lines: number
  textRef: RefObject<HTMLDivElement | null>
  onMore: () => void
}) {
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = textRef.current
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [body, lines, textRef])
  return (
    <>
      <div
        data-testid="wb-card-body"
        ref={textRef}
        className={cn('whitespace-pre-line break-words', BODY_TEXT_CLS)}
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: lines,
          overflow: 'hidden',
        }}
      >
        {body}
      </div>
      {clamped ? (
        <button
          type="button"
          className="nodrag mt-0.5 text-[13px] font-semibold text-pp-ink-blue hover:underline"
          onClick={event => {
            event.stopPropagation()
            onMore()
          }}
        >
          ... more
        </button>
      ) : null}
    </>
  )
}

/**
 * The title and body are a local draft, seeded once when editing starts - not `value={item.body}`.
 *
 * ```
 *   keystroke ──▶ updateItem ──▶ board state ──▶ Canvas nodes
 *                                                   │ React Flow copies them into its store
 *                                                   ▼ in a useEffect, one pass later
 *                                              node.data.item ──▶ this card
 * ```
 *
 * Bound to `data.item`, the field's value always trailed the DOM by that pass. A second key
 * typed inside it met the first key's value on its way in, React wrote that older text over
 * the field, and the caret jumped to the end: typing "AB" at the start of a line gave "A" in
 * place and "B" after the last word. The shape and frame labels are uncontrolled for the same
 * reason. Nothing else writes these fields while this editor holds focus (focusing the
 * inspector blurs it, which ends the edit), so the draft cannot miss a change.
 */
function InlineEditor({
  id,
  title: initialTitle,
  body: initialBody,
  showBody,
}: {
  id: string
  title: string
  body: string
  showBody: boolean
}) {
  const ui = useBoardUi()
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // After React Flow's own focus handling for a freshly selected node, which would
    // otherwise pull focus back to the node wrapper and swallow the first keystrokes.
    const timer = setTimeout(() => {
      titleRef.current?.focus()
      titleRef.current?.select()
    }, 30)
    return () => clearTimeout(timer)
  }, [])

  const stop = () => ui.setEditingId(null)

  return (
    <div
      ref={rootRef}
      className={cn(
        'nodrag nopan nowheel mt-2.5 flex flex-col gap-1.5',
        // Matches the title's mb-1.5 above a to-do list, so its rows do not shift.
        showBody ? 'min-h-0 flex-1' : 'pb-0.5'
      )}
      onBlur={event => {
        if (
          !rootRef.current?.contains(event.relatedTarget as HTMLElement | null)
        )
          stop()
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          stop()
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) stop()
      }}
    >
      <input
        ref={titleRef}
        aria-label="Title"
        value={title}
        maxLength={LIMITS.title}
        placeholder="Title"
        onChange={event => {
          const next = event.target.value.replace(/[\r\n]+/g, ' ')
          setTitle(next)
          ui.actions.updateItem(id, { title: next })
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            event.preventDefault()
            if (showBody) bodyRef.current?.focus()
            else stop()
          }
        }}
        // No vertical padding: the same line box as the title it replaces, so a to-do list
        // (no body field to give room back) keeps every row where it was.
        className="w-full rounded-lg bg-white/80 px-1.5 py-0 font-display text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] outline-none ring-1 ring-pp-line focus:ring-pp-ink-blue"
      />
      {showBody ? (
        <textarea
          ref={bodyRef}
          aria-label="Body"
          value={body}
          maxLength={LIMITS.body}
          placeholder="What is true about this?"
          rows={2}
          onChange={event => {
            setBody(event.target.value)
            ui.actions.updateItem(id, { body: event.target.value })
          }}
          className="min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-lg bg-white/80 px-1.5 py-1 text-[15.5px] leading-[1.45] text-pp-text/75 outline-none ring-1 ring-pp-line focus:ring-pp-ink-blue"
        />
      ) : null}
    </div>
  )
}

function TodoRows({
  id,
  rows,
  editable,
}: {
  id: string
  rows: TodoRow[]
  editable: boolean
}) {
  const ui = useBoardUi()
  const [draft, setDraft] = useState('')
  const [editingRow, setEditingRow] = useState<string | null>(null)

  const write = (next: TodoRow[]) => ui.actions.updateItem(id, { todos: next })

  return (
    <div className="mt-1 space-y-1">
      {rows.map(row => (
        <div
          key={row.id}
          className="group/row flex items-center gap-2"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={row.done}
            aria-label={row.text || 'To-do'}
            disabled={ui.readOnly}
            onClick={event => {
              event.stopPropagation()
              write(
                rows.map(r => (r.id === row.id ? { ...r, done: !r.done } : r))
              )
            }}
            className={cn(
              'nodrag grid h-[17px] w-[17px] flex-none place-items-center rounded-[5px] border-[1.5px] border-pp-text/30',
              row.done && 'border-pp-text bg-pp-text text-white'
            )}
          >
            {row.done ? (
              <Check
                aria-hidden
                size={11}
                strokeWidth={3}
              />
            ) : null}
          </button>
          {editingRow === row.id ? (
            <input
              autoFocus
              aria-label="To-do text"
              defaultValue={row.text}
              maxLength={LIMITS.todoText}
              onBlur={event => {
                write(
                  rows.map(r =>
                    r.id === row.id
                      ? {
                          ...r,
                          text: event.target.value.replace(/[\r\n]+/g, ' '),
                        }
                      : r
                  )
                )
                setEditingRow(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.blur()
                }
              }}
              className="nodrag min-w-0 flex-1 rounded bg-white/80 px-1 outline-none ring-1 ring-pp-line"
            />
          ) : (
            <span
              className={cn(
                'min-w-0 flex-1 break-words',
                row.done && 'text-pp-muted line-through'
              )}
              onDoubleClick={event => {
                if (!editable) return
                event.stopPropagation()
                setEditingRow(row.id)
              }}
            >
              {row.text || ' '}
            </span>
          )}
          {editable ? (
            <button
              type="button"
              aria-label={`Remove ${row.text || 'row'}`}
              onClick={event => {
                event.stopPropagation()
                write(rows.filter(r => r.id !== row.id))
              }}
              className="nodrag invisible text-pp-muted hover:text-pp-text group-hover/row:visible"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      ))}
      {editable && rows.length < LIMITS.todos ? (
        <label className="flex items-center gap-2 text-pp-muted">
          <Plus
            aria-hidden
            size={16}
          />
          <input
            aria-label="Add a step"
            value={draft}
            maxLength={LIMITS.todoText}
            placeholder="Add a step"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && draft.trim()) {
                event.preventDefault()
                write([
                  ...rows,
                  {
                    id: Math.random().toString(36).slice(2, 10),
                    text: draft.trim(),
                    done: false,
                  },
                ])
                setDraft('')
              }
            }}
            className="nodrag min-w-0 flex-1 bg-transparent outline-none placeholder:text-pp-muted/70"
          />
        </label>
      ) : null}
    </div>
  )
}

export default memo(CardNodeView)
