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
  SquareDashedMousePointer,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, memo } from 'react'

import type { Tool } from '@/components/whiteboard/shortcuts'
import { cn } from '@/lib/utils'

/**
 * The floating tool rail (wireframe-board.png). Every button carries its shortcut letter and
 * an `aria-label` that says it ("Text card, T"), and `aria-pressed` on the active tool (DR9).
 *
 * ```
 *   md, lg   vertical, left edge, centred         every tool
 *   sm       horizontal, along the top, scrolls   every tool - the same rail, laid flat
 *   touch    + "Select box" after Select          one finger pans there, so a box needs a mode
 * ```
 *
 * Phones used to get a "Drawing needs a larger screen" note instead (DR8, since revised): the
 * tools themselves never needed a mouse, only room, and a rail that scrolls sideways gives
 * them that.
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

const buttonCls = (large: boolean, active: boolean) =>
  cn(
    'relative grid shrink-0 place-items-center rounded-xl text-pp-muted transition-colors hover:bg-pp-text/5 hover:text-pp-text disabled:cursor-not-allowed disabled:opacity-40',
    large ? 'h-11 w-11' : 'h-10 w-10',
    active && 'bg-pp-text text-white hover:bg-pp-text hover:text-white'
  )

function ToolRail({
  tool,
  onTool,
  disabled,
  large,
  horizontal = false,
  boxSelect,
  className,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  disabled: boolean
  /** 44px targets below lg, and for a finger at any width (DR8). */
  large: boolean
  /** Laid along the top edge (sm). */
  horizontal?: boolean
  /** Touch only: one box selection, then back to panning. */
  boxSelect?: { on: boolean; onToggle: () => void }
  className?: string
}) {
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      data-testid="wb-tool-rail"
      className={cn(
        'absolute z-10 flex gap-1 rounded-[18px] border border-pp-line bg-white/90 p-1.5 shadow-[0_18px_36px_rgba(46,35,28,0.08)]',
        horizontal
          ? 'left-3 top-3 max-w-[calc(100%-1.5rem)] flex-row overflow-x-auto overscroll-x-contain [scrollbar-width:none]'
          : 'left-3.5 top-1/2 max-h-[calc(100%-1.75rem)] -translate-y-1/2 flex-col overflow-y-auto [scrollbar-width:none]',
        className
      )}
    >
      {GROUPS.map((group, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <hr
              className={cn(
                'shrink-0 border-pp-line',
                horizontal
                  ? 'mx-0.5 my-1 h-auto self-stretch border-l border-t-0'
                  : 'mx-1 my-0.5'
              )}
            />
          ) : null}
          {group.map(({ tool: value, label, key, Icon }) => (
            <Fragment key={value}>
              <button
                type="button"
                aria-label={`${label}, ${key}`}
                aria-pressed={tool === value && !boxSelect?.on}
                title={`${label} (${key})`}
                disabled={disabled}
                onClick={() => onTool(value)}
                className={buttonCls(large, tool === value && !boxSelect?.on)}
              >
                <Icon
                  aria-hidden
                  size={16}
                />
                <small className="absolute bottom-0.5 right-1 font-display text-[8.5px] font-semibold opacity-55">
                  {key}
                </small>
              </button>
              {value === 'select' && boxSelect ? (
                <button
                  type="button"
                  aria-label="Select box"
                  aria-pressed={boxSelect.on}
                  title="Select box: drag one finger to pick several items"
                  disabled={disabled}
                  onClick={boxSelect.onToggle}
                  className={buttonCls(large, boxSelect.on)}
                >
                  <SquareDashedMousePointer
                    aria-hidden
                    size={16}
                  />
                </button>
              ) : null}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  )
}

export default memo(ToolRail)
