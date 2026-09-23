'use client'

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * What a modal owes a keyboard user (DR9), shared by `ConfirmDialog` and the whiteboard's
 * shortcut list: focus moves in when it opens, stays in while it is open, Escape closes it,
 * and focus goes back to whatever opened it.
 *
 * ```
 *   open ──▶ focus the first enabled control, or the dialog itself (tabIndex -1)
 *   Tab  ──▶ wraps inside; with nothing enabled (a busy dialog) it stays on the dialog
 *   focus lands outside (a click, a stray Tab) ──▶ pulled back in
 *   the focused button becomes disabled ──▶ focus falls to <body>; the dialog takes it
 *   close ──▶ back to the opener
 * ```
 *
 * The "stays in" part is the one that was missing: the restore dialog opens busy ("Checking
 * file...") with every button disabled, so the old "focus the first button" found nothing,
 * focus stayed on the page behind, and Tab wrapped only when it happened to be ON the first
 * or last button - which it never was. The container is the fallback target so there is
 * always something inside to hold focus.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape: () => void
) {
  // Callers pass inline handlers; a ref keeps the effect tied to open/close only, instead of
  // re-running (and re-grabbing focus) on every parent render.
  const escape = useRef(onEscape)
  useEffect(() => {
    escape.current = onEscape
  })

  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement as HTMLElement | null

    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    const inside = (node: unknown) =>
      node instanceof Node && dialog.contains(node)
    const pullIn = (last = false) => {
      const list = focusables()
      // The first control of a confirm is Cancel, so Enter is never destructive by accident.
      list[last ? list.length - 1 : 0]?.focus()
      if (!inside(document.activeElement)) dialog.focus({ preventScroll: true })
    }

    pullIn()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        escape.current()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusables()
      const active = document.activeElement
      if (list.length === 0 || !inside(active)) {
        event.preventDefault()
        pullIn(event.shiftKey)
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!inside(event.target)) pullIn()
    }
    // A button disabled while focused drops focus to <body> without any focus event.
    const observer = new MutationObserver(() => {
      if (!inside(document.activeElement)) pullIn()
    })
    observer.observe(dialog, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
    })

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      opener?.focus?.()
    }
  }, [open, ref])
}
