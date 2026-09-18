'use client'

import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * A select that is styled all the way down, unlike `<select>`.
 *
 * ## Why not just style the native element
 *
 * Because the part that looks wrong cannot be reached. A `<select>` accepts a border, a
 * radius and a background, and then the browser draws the option list itself: system font,
 * system colours, square corners, a hard blue highlight. On a page built out of frosted
 * panels and `--pp-*` tokens that list is the one element that belongs to the operating
 * system, and `option { }` has almost no effect in any engine. There is no CSS answer.
 *
 * ## What is given up, honestly
 *
 * The native control hands a phone its own wheel or sheet picker, which is genuinely better
 * than any list rendered in the page, and it comes with type-ahead, keyboard behaviour and
 * form integration for free. Replacing it means re-implementing all of that - which is what
 * the rest of this file is - and the mobile picker is simply lost.
 *
 * So this is only worth it where the list is short and the surface is heavily designed. It
 * is used by the blog editor's two fields; it is deliberately not a codebase-wide swap.
 *
 * ## The keyboard contract
 *
 * ```
 *   closed   Enter · Space · ArrowUp · ArrowDown   open, highlighting the current value
 *   open     ArrowUp / ArrowDown                   move the highlight
 *            Home / End                            first / last
 *            a-z, 0-9                              jump to the next option starting with it
 *            Enter · Space                         commit the highlight
 *            Escape · Tab · click outside          close, changing nothing
 * ```
 *
 * `aria-activedescendant` rather than moving focus into the list: focus stays on the trigger,
 * which is what keeps the highlight and the browser's focus ring describing the same thing.
 *
 * ## The list is opaque, and that is not a style preference
 *
 * It was `bg-white/92`, which is the panel value the rest of the editor uses - and the rest of
 * the editor is not a popup. At 8% transparency the fields underneath stayed legible THROUGH
 * the open list: the "Pillar post for this series" label and the Tags field read straight
 * through the options, so the one moment the list has to be unambiguous is the moment it
 * showed two competing sets of words in the same pixels. Backdrop blur alone does not fix it,
 * because blur softens what is behind without hiding the contrast.
 *
 * So: effectively opaque (98%, enough that nothing behind resolves) plus a heavier
 * `backdrop-blur-xl`, which keeps it in the same frosted vocabulary as every other surface
 * instead of becoming a flat white rectangle. The shadow is tighter and darker than
 * `shadow-panel` for the same reason - a popup has to read as being above the page, and
 * `shadow-panel` is tuned for cards that sit in it.
 */

export type SelectOption = {
  value: string
  label: string
}

export default function SelectField({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  id: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Used when the field's `<label htmlFor>` is not adjacent - otherwise the label wins. */
  ariaLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  /** Type-ahead buffer. Cleared after a pause, so "ar" finds `article` but "a" then a wait
   * starts again from `a`. */
  const typed = useRef({ text: '', at: 0 })

  const listId = useId()
  const selectedIndex = Math.max(
    0,
    options.findIndex(option => option.value === value)
  )
  const selected = options[selectedIndex]

  const openList = () => {
    setActive(selectedIndex)
    setOpen(true)
  }

  const commit = (index: number) => {
    const option = options[index]
    setOpen(false)
    triggerRef.current?.focus()
    if (option && option.value !== value) onChange(option.value)
  }

  // Keep the highlighted row in view when the arrow keys walk past the edge of a list that
  // has started scrolling.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  useEffect(() => {
    if (!open) return

    // `pointerdown`, not `click`: see PostRowActions - a press that turns into a scroll should
    // dismiss at the start of the gesture rather than at the end of it.
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        return
      case 'Tab':
        // Not prevented - Tab should still move on. The list just closes behind it.
        setOpen(false)
        return
      case 'ArrowDown':
        event.preventDefault()
        setActive(index => Math.min(options.length - 1, index + 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive(index => Math.max(0, index - 1))
        return
      case 'Home':
        event.preventDefault()
        setActive(0)
        return
      case 'End':
        event.preventDefault()
        setActive(options.length - 1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(active)
        return
    }

    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now()
      const text = (now - typed.current.at < 600 ? typed.current.text : '') + event.key.toLowerCase()
      typed.current = { text, at: now }

      const found = options.findIndex(option => option.label.toLowerCase().startsWith(text))
      if (found >= 0) {
        event.preventDefault()
        setActive(found)
      }
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        id={id}
        type='button'
        role='combobox'
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup='listbox'
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className='flex w-full items-center justify-between gap-2 rounded-[1.05rem] border border-pp-line bg-white/78 px-4 py-3 text-left text-sm text-pp-text shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition hover:bg-white focus-visible:border-pp-blue/55 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-pp-blue/10'
      >
        <span className='truncate'>{selected?.label ?? ''}</span>
        <ChevronDown
          aria-hidden
          size={15}
          className={`shrink-0 text-pp-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          role='listbox'
          aria-label={ariaLabel}
          className='absolute left-0 right-0 z-30 mt-2 max-h-64 overflow-y-auto rounded-[1.05rem] border border-pp-line bg-[rgba(255,253,250,0.98)] p-1.5 shadow-[0_24px_48px_rgba(46,35,28,0.18)] backdrop-blur-xl'
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isActive = index === active

            return (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role='option'
                aria-selected={isSelected}
                data-active={isActive}
                // The pointer moves the highlight so the hovered row and the keyboard row are
                // never two different rows, which is the usual way this pattern goes wrong.
                onPointerEnter={() => setActive(index)}
                onClick={() => commit(index)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-[0.8rem] px-3 py-2 text-sm transition ${
                  isActive ? 'bg-pp-blue/10 text-pp-text' : 'text-pp-muted'
                }`}
              >
                <span className='truncate'>{option.label}</span>
                {isSelected ? <Check aria-hidden size={14} className='shrink-0 text-pp-blue' /> : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
