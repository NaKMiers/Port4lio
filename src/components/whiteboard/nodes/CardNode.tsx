'use client'

import { NodeResizeControl, type Node, type NodeProps } from '@xyflow/react'
import { Check, Plus, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
 */

type CardNode = Node<ItemNodeData, 'card'>

const BODY_CLAMP_LINES = 6

function formatMonth(day: string | null) {
  return day ? day.slice(0, 7) : null
}

function CardNodeView({ id, data, selected }: NodeProps<CardNode>) {
  const { item, hidden, hiddenByFrame, error } = data
  const ui = useBoardUi()
  const editing = ui.editingId === id
  const readOnly = ui.readOnly

  const meta = [
    item.status,
    item.targetBy ? `by ${formatMonth(item.targetBy)}` : null,
    item.when && !item.targetBy ? `when ${formatMonth(item.when)}` : null,
  ].filter(Boolean)

  const done = item.todos.filter(row => row.done).length

  return (
    <div
      data-testid="wb-card"
      data-item-id={id}
      data-hidden={hidden || undefined}
      className={cn(
        'wb-card group/card relative h-full w-full rounded-2xl border border-pp-line bg-pp-panel-strong px-[13px] py-3 text-[13.5px] leading-snug text-pp-text shadow-[0_14px_30px_rgba(46,35,28,0.08)]',
        hiddenByFrame && 'opacity-55',
        selected && 'ring-2 ring-pp-ink-blue ring-offset-2 ring-offset-pp-bg',
        error && 'ring-2 ring-pp-ink-rose ring-offset-2 ring-offset-pp-bg',
        data.pulse && hidden && 'wb-pulse'
      )}
    >
      <NodeHandles />
      {selected && !readOnly ? (
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
      ) : null}

      <div className="flex min-h-[20px] items-center gap-2 pr-5">
        <MeaningChip meaning={item.meaning} />
        {meta.length ? (
          <span className="truncate font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-pp-muted">
            {meta.join(' · ')}
          </span>
        ) : null}
      </div>
      {hidden ? <HiddenBadge className="absolute right-2.5 top-2.5" /> : null}
      {error ? <ErrorBadge message={error} /> : null}

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
              'mb-1 mt-2 break-words font-display text-[14.5px] font-semibold tracking-[-0.01em]',
              !item.title && 'text-pp-muted/70'
            )}
          >
            {item.title ||
              (item.form === 'todo' ? 'Untitled list' : 'Untitled card')}
          </h4>
          {item.form === 'text' && item.body ? (
            <ClampedBody
              body={item.body}
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
        <p className="mt-2 text-[11.5px] text-pp-muted">
          {done} of {item.todos.length} done
        </p>
      ) : null}

      {item.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.tags.map(tag => (
            <span
              key={tag}
              className="rounded-md bg-pp-text/5 px-1.5 py-px font-mono text-[11px] text-pp-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {!meta.length && !item.when && item.form === 'text' && !item.body ? (
        <p className="mt-1 text-[11.5px] text-pp-muted">
          created {item.createdAt.slice(0, 10)}
        </p>
      ) : null}
    </div>
  )
}

function ClampedBody({ body, onMore }: { body: string; onMore: () => void }) {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [body])
  return (
    <>
      <p
        ref={ref}
        className="whitespace-pre-line break-words text-pp-muted"
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: BODY_CLAMP_LINES,
          overflow: 'hidden',
        }}
      >
        {body}
      </p>
      {clamped ? (
        <button
          type="button"
          className="nodrag mt-0.5 text-[11.5px] font-semibold text-pp-ink-blue hover:underline"
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

function InlineEditor({
  id,
  title,
  body,
  showBody,
}: {
  id: string
  title: string
  body: string
  showBody: boolean
}) {
  const ui = useBoardUi()
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

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [body])

  const stop = () => ui.setEditingId(null)

  return (
    <div
      ref={rootRef}
      className="nodrag nopan nowheel mt-2 space-y-1"
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
        onChange={event =>
          ui.actions.updateItem(id, {
            title: event.target.value.replace(/[\r\n]+/g, ' '),
          })
        }
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            event.preventDefault()
            if (showBody) bodyRef.current?.focus()
            else stop()
          }
        }}
        className="w-full rounded-lg bg-white/80 px-1.5 py-0.5 font-display text-[14.5px] font-semibold tracking-[-0.01em] outline-none ring-1 ring-pp-line focus:ring-pp-ink-blue"
      />
      {showBody ? (
        <textarea
          ref={bodyRef}
          aria-label="Body"
          value={body}
          maxLength={LIMITS.body}
          placeholder="What is true about this?"
          rows={2}
          onChange={event =>
            ui.actions.updateItem(id, { body: event.target.value })
          }
          className="w-full resize-none rounded-lg bg-white/80 px-1.5 py-1 text-[13px] text-pp-muted outline-none ring-1 ring-pp-line focus:ring-pp-ink-blue"
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
          className="group/row flex items-center gap-2 text-[13px]"
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
              'nodrag grid h-[15px] w-[15px] flex-none place-items-center rounded-[5px] border-[1.5px] border-pp-text/30',
              row.done && 'border-pp-text bg-pp-text text-white'
            )}
          >
            {row.done ? (
              <Check
                aria-hidden
                size={10}
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
              <X size={12} />
            </button>
          ) : null}
        </div>
      ))}
      {editable && rows.length < LIMITS.todos ? (
        <label className="flex items-center gap-2 text-[13px] text-pp-muted">
          <Plus
            aria-hidden
            size={14}
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
