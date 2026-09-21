'use client'

import { MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import {
  ghostBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'

/**
 * The per-post actions on `/admin/blog`, inline on a wide screen and behind one button on a
 * narrow one.
 *
 * ```
 *   >= md    [ View ][ Edit ][ Archive ][ Delete ]
 *
 *   <  md    [ ⋯ Actions ]
 *              └─ opens a menu carrying exactly the same set
 * ```
 *
 * ## Why the actions are data rather than JSX
 *
 * They have to be rendered twice - once inline, once inside the menu - and the two are
 * different enough in markup (`role='menuitem'`, full-width rows, a divider) that sharing a
 * rendered node would mean styling one to look like the other. Describing them once and
 * rendering each list from the description is what keeps "the menu has the same actions as
 * the row" true by construction rather than by two lists being edited together.
 *
 * ## `hidden` / `md:hidden`, not a JS media query
 *
 * Tailwind's `hidden` is `display: none`, which removes a subtree from the accessibility tree
 * as well as from the layout, so a screen reader is never offered both copies. A `matchMedia`
 * hook would render only one - and would also need a resize listener, an effect, and a first
 * paint with neither list decided.
 *
 * ## Why the menu is opaque
 *
 * Same reason as `SelectField`'s option list, and it was the same mistake: `bg-white/92` is
 * the value the cards use, and a popup is not a card. Eight percent is enough for the post
 * title and slug underneath to stay legible through the menu. 98% plus `backdrop-blur-xl`
 * keeps the frosted look without letting two sets of words share the same pixels.
 *
 * ## Why the menu closes on `pointerdown` and not on `click`
 *
 * A `click` listener fires after the press completes, so pressing on another row's trigger
 * would close this menu and open that one in the same gesture - which is correct - but a
 * press that begins on a scroll leaves the menu open under the finger. `pointerdown` closes
 * at the start of the gesture, which is when the intent to leave is already expressed.
 */

export type RowAction = {
  key: string
  label: string
  /** A link action (Edit, View). Mutually exclusive with `onSelect`. */
  href?: string
  onSelect?: () => void
  title?: string
  disabled?: boolean
  /** Rendered apart from the rest in the menu - used by Delete. */
  separated?: boolean
}

export default function PostRowActions({
  actions,
  label,
}: {
  actions: RowAction[]
  /** Names the menu for a screen reader, e.g. `Actions for "five things Next 16 did"`. */
  label: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Focus goes back to the trigger rather than to the body, so dismissing the menu does
      // not drop a keyboard user at the top of the page.
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      {/* Wide screens: unchanged behaviour, the five buttons in a row. */}
      <span className="hidden flex-wrap gap-1 md:flex">
        {actions.map(action =>
          action.href ? (
            <Link
              key={action.key}
              className={ghostBtnCls}
              href={action.href}
              title={action.title}
            >
              {action.label}
            </Link>
          ) : (
            <button
              key={action.key}
              className={ghostBtnCls}
              disabled={action.disabled}
              onClick={action.onSelect}
              title={action.title}
            >
              {action.label}
            </button>
          )
        )}
      </span>

      {/* Narrow screens: one trigger. */}
      <div
        ref={rootRef}
        className="relative md:hidden"
      >
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          className={`${secondaryBtnCls} gap-1.5`}
          onClick={() => setOpen(value => !value)}
        >
          <MoreHorizontal
            aria-hidden
            size={14}
          />
          Actions
        </button>

        {open ? (
          <div
            role="menu"
            aria-label={label}
            className="absolute right-0 z-30 mt-2 min-w-[11rem] overflow-hidden rounded-[1.1rem] border border-pp-line bg-[rgba(255,253,250,0.98)] p-1.5 shadow-[0_24px_48px_rgba(46,35,28,0.18)] backdrop-blur-xl"
          >
            {actions.map(action => {
              const itemCls =
                'block w-full rounded-[0.85rem] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted no-underline transition hover:bg-white hover:text-pp-text disabled:cursor-not-allowed disabled:opacity-50'

              return (
                <div key={action.key}>
                  {action.separated ? (
                    <div
                      className="my-1.5 h-px bg-pp-line"
                      role="presentation"
                    />
                  ) : null}
                  {action.href ? (
                    <Link
                      role="menuitem"
                      className={itemCls}
                      href={action.href}
                      title={action.title}
                      onClick={() => setOpen(false)}
                    >
                      {action.label}
                    </Link>
                  ) : (
                    <button
                      role="menuitem"
                      type="button"
                      className={itemCls}
                      disabled={action.disabled}
                      title={action.title}
                      onClick={() => {
                        setOpen(false)
                        action.onSelect?.()
                      }}
                    >
                      {action.label}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </>
  )
}
