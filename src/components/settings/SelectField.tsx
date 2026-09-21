'use client'

import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
 * So this is only worth it where the list is short and the surface is heavily designed. It is
 * used by the blog editor's Kind and Series fields and by the generic `select` control in
 * `GenerateBlogDialog` - three admin-only surfaces, every option list a handful of entries.
 * It is still deliberately not a codebase-wide swap: nothing else in the app currently pairs a
 * long or dynamic option list with a public, mobile-heavy surface, and the day one does, that
 * field keeps the native `<select>` rather than paying this component's cost for no benefit.
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
 *
 * ## The list portals to `document.body`, and is positioned in JS
 *
 * Every field that opens this near the bottom of its card used to get its list sheared off
 * by that card - `Section`'s `<details>` is `overflow-hidden`, which was needed for its own
 * rounded corners and not for anything a child does, but CSS clips an `absolute` descendant
 * against EVERY ancestor with a non-`visible` overflow regardless of which one actually needs
 * it. The list was never wide enough to escape a card sideways; it was tall enough, opened low
 * enough in a "Cover image" card, to escape it downward - measured on the "Image generation
 * model" field first, but the same clip was waiting under every other field this component
 * gets used for.
 *
 * A portal is the only fix that does not become "audit every `Section` caller for a reason it
 * might need that clip" - `Section` is shared by the whole settings editor, and the callers
 * that DO put an image or a drag handle inside one are exactly the ones a blind
 * `overflow-visible` swap could break. Rendering the list into `document.body` and positioning
 * it with `getBoundingClientRect()` sidesteps every ancestor's overflow and z-index entirely,
 * for every field this component renders, not just the one that got noticed.
 *
 * `position: fixed` rather than `absolute`, because `getBoundingClientRect()` already returns
 * viewport-relative coordinates - pairing it with `absolute` would need the scroll offset
 * added back in, for no benefit. The trade is the two listeners below: a fixed-position popup
 * does not move when its trigger scrolls, so the list has to be told to. `scroll` is bound
 * with `capture: true` because the trigger can be inside any nested scrollable ancestor -
 * `capture` is the one option that reaches all of them from a single listener on `window`.
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
  disabled = false,
}: {
  id: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  /** Used when the field's `<label htmlFor>` is not adjacent - otherwise the label wins. */
  ariaLabel?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  /**
   * Where the portaled list renders. `null` for exactly one frame, before the layout effect
   * below has measured the trigger - the list stays unmounted until then.
   *
   * `placement` flips to `'above'` when the trigger sits too low in the viewport for the list
   * to open downward without running off the bottom of the screen - the "Image generation
   * model" field on the cover section is the field that surfaced this: on a shorter viewport
   * it sits close to the bottom of the card, and the list used to open below it regardless,
   * off screen. `'above'` is positioned with `bottom`, not a computed `top`, on purpose: the
   * list's real height depends on how many options wrap or how far `max-h-64` caps it, which
   * is not known until it is in the DOM, and `bottom` anchors it to the trigger's top edge and
   * lets it grow upward by however tall it actually turns out to be instead of guessing.
   */
  const [position, setPosition] = useState<{
    left: number
    width: number
    placement: 'below' | 'above'
    top: number
    bottom: number
  } | null>(null)
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
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  // Measured before paint, so the list never flashes at its stale position for a frame - and
  // re-measured on every scroll or resize while open, since `position: fixed` does not track
  // the trigger the way `position: absolute` used to.
  useLayoutEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return

      // A rough ceiling on how tall the list can get - `max-h-64` (256px) caps it regardless,
      // and this only has to decide which side to open on. The real height, once the list is
      // actually in the DOM, is handled by anchoring `above` to `bottom` rather than a computed
      // `top` - see the state comment above.
      const estimatedListHeight = Math.min(options.length * 40 + 12, 256)
      const spaceBelow = window.innerHeight - rect.bottom
      const openAbove =
        spaceBelow < estimatedListHeight + 8 && rect.top > spaceBelow

      setPosition({
        left: rect.left,
        width: rect.width,
        placement: openAbove ? 'above' : 'below',
        top: rect.bottom + 8,
        bottom: window.innerHeight - rect.top + 8,
      })
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
    // `options.length` and not `options`: the array is rebuilt on every render by most callers
    // (`IMAGE_MODEL_SELECT_OPTIONS` is spread, the dynamic kind/series lists are mapped), so
    // depending on the array itself would tear down and re-add the scroll listener on every
    // render of the parent. The length is the only thing `updatePosition` actually reads.
  }, [open, options.length])

  useEffect(() => {
    if (!open) return

    // `pointerdown`, not `click`: see PostRowActions - a press that turns into a scroll should
    // dismiss at the start of the gesture rather than at the end of it.
    //
    // Checked against BOTH refs, not just `rootRef`: the list portals to `document.body` now,
    // so it is no longer a DOM descendant of `rootRef` even though React still treats it as
    // one. Checking only `rootRef` would make every click inside the list read as "outside" -
    // closing the list on its own pointerdown, before the option's `onClick` ever runs.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !rootRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      )
        setOpen(false)
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

    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const now = Date.now()
      const text =
        (now - typed.current.at < 600 ? typed.current.text : '') +
        event.key.toLowerCase()
      typed.current = { text, at: now }

      const found = options.findIndex(option =>
        option.label.toLowerCase().startsWith(text)
      )
      if (found >= 0) {
        event.preventDefault()
        setActive(found)
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={`relative ${className ?? ''}`}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="bg-white/78 flex w-full items-center justify-between gap-2 rounded-[1.05rem] border border-pp-line px-4 py-3 text-left text-sm text-pp-text shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition hover:bg-white focus-visible:border-pp-blue/55 focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-pp-blue/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown
          aria-hidden
          size={15}
          className={`shrink-0 text-pp-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              style={{
                left: position.left,
                width: position.width,
                ...(position.placement === 'above'
                  ? { bottom: position.bottom }
                  : { top: position.top }),
              }}
              /*
                `z-[70]`, and the number is load-bearing rather than "a big one".

                `z-30` was right while the list was `absolute` INSIDE this component: it sat in
                whatever stacking context its own dialog had already established, so it painted
                above that dialog's content by construction. Portaling it to `document.body`
                moved it into the ROOT stacking context, where it is a sibling of every overlay
                in the app rather than a descendant of one - and `GenerateBlogDialog`,
                `TaxonomyDialog` and `ConfirmDialog` are all `fixed inset-0 z-[60]`. Nothing
                between `<body>` and those dialogs establishes a stacking context
                (`AdminChrome`'s wrapper is `relative` with no `z-index`, and `overflow: clip`
                establishes none), so 30 against 60 is compared directly and the list opened
                BEHIND the dialog that owns it - invisible under a 99%-opaque panel, on every
                select in the Generate dialog.

                70 clears `z-[60]` and the `z-[55]` save dock. A portaled popover has to outrank
                every overlay it can be opened from; it is only mounted while open, so there is
                nothing for it to sit on top of the rest of the time.
              */
              className="fixed z-[70] max-h-64 overflow-y-auto rounded-[1.05rem] border border-pp-line bg-[rgba(255,253,250,0.98)] p-1.5 shadow-[0_24px_48px_rgba(46,35,28,0.18)] backdrop-blur-xl"
            >
              {options.map((option, index) => {
                const isSelected = option.value === value
                const isActive = index === active

                return (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    data-active={isActive}
                    // The pointer moves the highlight so the hovered row and the keyboard row
                    // are never two different rows, which is the usual way this pattern goes
                    // wrong.
                    onPointerEnter={() => setActive(index)}
                    onClick={() => commit(index)}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-[0.8rem] px-3 py-2 text-sm transition ${
                      isActive ? 'bg-pp-blue/10 text-pp-text' : 'text-pp-muted'
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected ? (
                      <Check
                        aria-hidden
                        size={14}
                        className="shrink-0 text-pp-blue"
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
