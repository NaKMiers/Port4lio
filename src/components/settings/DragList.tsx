'use client'

import { GripVertical } from 'lucide-react'
import React, { useRef, useState } from 'react'

/**
 * A reorderable list built on native HTML5 drag and drop.
 *
 * Dragging is armed from a grip handle rather than the row itself, because every row here
 * is a card full of text inputs and textareas - a `draggable` ancestor would swallow the
 * selection gesture inside them.
 *
 * Drop target semantics are "the dragged row takes this row's place", which is exactly
 * {@link moveItem}'s splice, so the highlighted row is literally where the item lands. No
 * midpoint maths, and no list that reshuffles under the pointer mid-drag.
 *
 * Lists nest: handlers `stopPropagation` once they have claimed an event, and an inner list
 * with no drag in flight never calls `preventDefault`, so the event bubbles out to the
 * outer list instead of being silently swallowed.
 *
 * The handle is also a real button: arrow keys move the row without a pointer, which is the
 * only way this is usable with a keyboard or a screen reader.
 */
export default function DragList({
  ids,
  onReorder,
  itemLabel,
  className = 'space-y-3',
  children,
}: {
  /** One stable key per row. Also the row count. */
  ids: string[]
  onReorder: (from: number, to: number) => void
  /** Singular noun used in the handle's accessible name, e.g. `skill block`. */
  itemLabel: string
  className?: string
  /** Renders one row. `handle` must be placed somewhere inside it to enable dragging. */
  children: (index: number, handle: React.ReactNode) => React.ReactNode
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([])

  const reset = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return
    onReorder(from, to)
    setAnnouncement(`Moved ${itemLabel} to position ${to + 1} of ${ids.length}`)
  }

  const moveByKeyboard = (from: number, to: number) => {
    move(from, to)
    // The rows are keyed by id, so the node at `to` is the one that just moved. Focus it
    // on the next frame, once React has committed the new order.
    requestAnimationFrame(() => handleRefs.current[to]?.focus())
  }

  return (
    <div className={className}>
      {ids.map((id, index) => {
        const isDragging = dragIndex === index
        const isTarget = dragIndex !== null && overIndex === index && !isDragging

        const handle = (
          <button
            type='button'
            ref={node => {
              handleRefs.current[index] = node
            }}
            draggable
            aria-label={`Reorder ${itemLabel}, position ${index + 1} of ${ids.length}. Drag, or use the arrow keys.`}
            title='Drag to reorder'
            className='inline-flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-[0.7rem] border border-transparent text-pp-muted transition hover:border-pp-line hover:bg-white/78 hover:text-pp-text focus-visible:border-pp-line focus-visible:bg-white focus-visible:text-pp-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pp-blue/15 active:cursor-grabbing'
            onDragStart={event => {
              event.stopPropagation()
              event.dataTransfer.effectAllowed = 'move'
              // Firefox starts no drag at all without some payload on the transfer.
              event.dataTransfer.setData('text/plain', id)
              const row = rowRefs.current[index]
              // Without this the drag image is the grip alone, which gives no sense of
              // what is being moved.
              if (row) event.dataTransfer.setDragImage(row, 24, 24)
              setDragIndex(index)
            }}
            onDragEnd={event => {
              event.stopPropagation()
              reset()
            }}
            // The section cards put this handle inside a <summary>; a bare click there
            // would expand or collapse the panel.
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                event.preventDefault()
                moveByKeyboard(index, index - 1)
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                event.preventDefault()
                moveByKeyboard(index, index + 1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                moveByKeyboard(index, 0)
              } else if (event.key === 'End') {
                event.preventDefault()
                moveByKeyboard(index, ids.length - 1)
              }
            }}
          >
            <GripVertical aria-hidden className='h-4 w-4' />
          </button>
        )

        return (
          <div
            key={id}
            ref={node => {
              rowRefs.current[index] = node
            }}
            onDragOver={event => {
              if (dragIndex === null) return
              // Claimed: this list owns the drag, so the outer list must not also react.
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'move'
              setOverIndex(index)
            }}
            onDrop={event => {
              if (dragIndex === null) return
              event.preventDefault()
              event.stopPropagation()
              move(dragIndex, index)
              reset()
            }}
            className={`rounded-[1.45rem] transition ${isDragging ? 'opacity-45' : ''} ${
              isTarget
                ? 'outline-dashed outline-2 outline-offset-2 outline-pp-blue/55'
                : 'outline-none'
            }`}
          >
            {children(index, handle)}
          </div>
        )
      })}

      <span aria-live='polite' className='sr-only'>
        {announcement}
      </span>
    </div>
  )
}
