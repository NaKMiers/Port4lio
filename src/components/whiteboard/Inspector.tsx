'use client'

import { Trash2 } from 'lucide-react'
import { memo } from 'react'

import {
  ghostBtnCls,
  inputCls,
  labelCls,
} from '@/components/settings/settings-utils'
import { ShortcutList } from '@/components/whiteboard/ShortcutsHelp'
import type { Board } from '@/components/whiteboard/useBoard'
import { cn } from '@/lib/utils'
import { LIMITS } from '@/lib/whiteboard/limits'

export interface InspectorProps {
  board: Board
  selection: { nodes: string[]; edges: string[] }
  onDelete: () => void
  className?: string
}

const FORM_LABEL = {
  text: 'Text card',
  todo: 'To-do card',
  shape: 'Shape',
  frame: 'Frame',
  ink: 'Sketch',
} as const

function Inspector({ board, selection, onDelete, className }: InspectorProps) {
  const { data, errors, actions } = board
  const items = selection.nodes.map(id => data.items[id]).filter(Boolean)

  if (items.length === 0 && selection.edges.length === 1) {
    const link = data.links[selection.edges[0]]
    if (link)
      return (
        <aside className={cn('flex flex-col gap-4 p-[18px]', className)}>
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
              onChange={event =>
                actions.updateLinkLabel(
                  link._id,
                  event.target.value.replace(/[\r\n]+/g, ' ')
                )
              }
            />
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="mt-auto inline-flex items-center gap-2 self-start font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-ink-rose"
          >
            <Trash2 size={14} />
            Delete link
          </button>
        </aside>
      )
  }

  if (items.length === 0)
    return (
      <aside className={cn('flex flex-col gap-3 p-[18px]', className)}>
        <p className={labelCls}>Nothing selected</p>
        <p className="text-[12px] leading-relaxed text-pp-muted">
          Select a card to edit its meaning, dates, links and AI visibility.
        </p>
        <p className={cn(labelCls, 'mt-3')}>Shortcuts</p>
        <ShortcutList />
      </aside>
    )

  if (items.length > 1)
    return (
      <aside className={cn('flex flex-col gap-4 p-[18px]', className)}>
        <p className={labelCls}>{items.length} items selected</p>
        <button
          type="button"
          onClick={onDelete}
          className="mt-auto inline-flex items-center gap-2 self-start font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-ink-rose"
        >
          <Trash2 size={14} />
          Delete {items.length} items
        </button>
      </aside>
    )

  const item = items[0]
  return (
    <aside className={cn('flex flex-col gap-4 p-[18px]', className)}>
      <div className="flex items-center justify-between">
        <p className={cn(labelCls, 'mb-0')}>{FORM_LABEL[item.form]}</p>
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-pp-muted">
          id {item._id.slice(0, 4)}...{item._id.slice(-2)}
        </span>
      </div>
      {errors[item._id] ? (
        <ErrorNotice
          message={errors[item._id]}
          onDiscard={() => actions.discard(item._id)}
        />
      ) : null}
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
            actions.updateItem(item._id, {
              title: event.target.value.replace(/[\r\n]+/g, ' '),
            })
          }
        />
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="mt-auto inline-flex items-center gap-2 self-start font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-ink-rose"
      >
        <Trash2 size={14} />
        Delete permanently
      </button>
    </aside>
  )
}

export function ErrorNotice({
  message,
  onDiscard,
}: {
  message: string
  onDiscard: () => void
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-pp-ink-rose/30 bg-pp-pink/10 px-3 py-2.5 text-[12.5px] text-pp-ink-rose"
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
