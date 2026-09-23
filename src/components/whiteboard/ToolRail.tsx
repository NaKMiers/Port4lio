'use client'

import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  Hash,
  ListTodo,
  MousePointer2,
  Pencil,
  Square,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, memo } from 'react'

import type { Tool } from '@/components/whiteboard/shortcuts'
import { cn } from '@/lib/utils'

/**
 * The floating tool rail (wireframe-board.png). Every button carries its shortcut letter and
 * an `aria-label` that says it ("Text card, T"), and `aria-pressed` on the active tool (DR9).
 * Below `md` it is replaced by a note, because drawing at phone width is out of scope (DR8).
 */

const GROUPS: { tool: Tool; label: string; key: string; Icon: LucideIcon }[][] =
  [
    [{ tool: 'select', label: 'Select', key: 'V', Icon: MousePointer2 }],
    [
      { tool: 'text', label: 'Text card', key: 'T', Icon: Type },
      { tool: 'todo', label: 'To-do card', key: 'L', Icon: ListTodo },
      { tool: 'rect', label: 'Rectangle', key: 'R', Icon: Square },
      { tool: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
      { tool: 'diamond', label: 'Diamond', key: 'D', Icon: Diamond },
      { tool: 'frame', label: 'Frame', key: 'F', Icon: Hash },
    ],
    [
      { tool: 'arrow', label: 'Arrow', key: 'A', Icon: ArrowUpRight },
      { tool: 'pen', label: 'Pen', key: 'P', Icon: Pencil },
      { tool: 'eraser', label: 'Eraser (ink only)', key: 'E', Icon: Eraser },
    ],
  ]

function ToolRail({
  tool,
  onTool,
  disabled,
  large,
  className,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  disabled: boolean
  /** 44px targets below lg (DR8). */
  large: boolean
  className?: string
}) {
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      className={cn(
        'absolute left-3.5 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-[18px] border border-pp-line bg-white/90 p-1.5 shadow-[0_18px_36px_rgba(46,35,28,0.08)]',
        className
      )}
    >
      {GROUPS.map((group, index) => (
        <Fragment key={index}>
          {index > 0 ? <hr className="mx-1 my-0.5 border-pp-line" /> : null}
          {group.map(({ tool: value, label, key, Icon }) => (
            <button
              key={value}
              type="button"
              aria-label={`${label}, ${key}`}
              aria-pressed={tool === value}
              title={`${label} (${key})`}
              disabled={disabled}
              onClick={() => onTool(value)}
              className={cn(
                'relative grid place-items-center rounded-xl text-pp-muted transition-colors hover:bg-pp-text/5 hover:text-pp-text disabled:cursor-not-allowed disabled:opacity-40',
                large ? 'h-11 w-11' : 'h-10 w-10',
                tool === value &&
                  'bg-pp-text text-white hover:bg-pp-text hover:text-white'
              )}
            >
              <Icon
                aria-hidden
                size={16}
              />
              <small className="absolute bottom-0.5 right-1 font-display text-[8.5px] font-semibold opacity-55">
                {key}
              </small>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  )
}

export default memo(ToolRail)
