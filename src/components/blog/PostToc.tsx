'use client'

import { List, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { TocEntry } from '@/lib/blog/toc'

/**
 * The contents list for a post, in two shapes.
 *
 * ```
 *   lg and up   a sticky column beside the article, highlighting the section being read
 *   below lg    a floating "Contents" pill, bottom right, that opens the list full screen
 * ```
 *
 * ## Why the links are still plain `#id` anchors
 *
 * The SEO half of this only works if the links are real. Google surfaces anchor links into a
 * page ("jump to") when it can see a list of in-page links matching addressable sections, and
 * native anchors already scroll, work with JavaScript off, and update the address bar so the
 * reader can share the section. Everything client-side here - the highlight, the overlay - is
 * layered on top of links that work without it. Both lists are server-rendered.
 *
 * ## Why `h3` links are indented and `h4` further
 *
 * Structure the reader can see is the point. A flat list of nine items all at one indent
 * tells them the post has nine sections; an indented one tells them it has three, with
 * subsections - which is the shape they are deciding about.
 *
 * ## Why the overlay is a native `<dialog>`
 *
 * `showModal()` gives the focus trap, Escape to close, the top layer and an inert page behind
 * it for free, and returns focus to the pill when it closes. Hand-rolling those is where
 * overlays usually go wrong for keyboard and screen-reader users.
 */

/** A heading counts as "being read" once its top has scrolled above this line. */
const ACTIVE_OFFSET_PX = 120

/** Matches Tailwind's `lg`, where the sticky column takes over from the pill. */
const DESKTOP_QUERY = '(min-width: 960px)'

/**
 * The id of the last heading whose top is above {@link ACTIVE_OFFSET_PX}, or null before
 * the first one. Recomputed at most once per frame while scrolling.
 *
 * `idsKey` is the ids joined with spaces, so the effect depends on a string rather than an
 * array whose identity changes every render.
 */
function useActiveHeading(idsKey: string): string | null {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const ids = idsKey ? idsKey.split(' ') : []
    if (ids.length === 0) return

    let frame = 0
    const update = () => {
      frame = 0
      let current: string | null = null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= ACTIVE_OFFSET_PX) current = id
        else break
      }
      setActive(current)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [idsKey])

  return active
}

function TocList({
  entries,
  active,
  size,
  onNavigate,
}: {
  entries: TocEntry[]
  active: string | null
  size: 'compact' | 'large'
  onNavigate?: () => void
}) {
  return (
    <ol
      className={
        size === 'compact'
          ? 'mt-3 space-y-0.5 border-l border-pp-line text-sm'
          : 'space-y-1 border-l border-pp-line text-base'
      }
    >
      {entries.map(entry => {
        const current = entry.id === active
        return (
          <li
            key={entry.id}
            // Indent by depth. `level` is 2, 3 or 4 - see `extractToc`, which anchors nothing
            // else - so the arithmetic cannot produce a class outside these three.
            style={{ paddingLeft: `${(entry.level - 2) * 0.9}rem` }}
          >
            {/* `--pp-blue` is a 2.70:1 decoration colour - fine as a hover tint on a link
                that is already legible, not fine as its resting state. `ink-blue` either way. */}
            <a
              href={`#${entry.id}`}
              onClick={onNavigate}
              aria-current={current ? 'location' : undefined}
              className={[
                '-ml-px block border-l-2 pl-3 leading-snug no-underline transition-colors',
                size === 'compact' ? 'py-1' : 'py-2.5',
                current
                  ? 'border-pp-ink-blue font-semibold text-pp-ink-blue'
                  : 'border-transparent text-pp-muted hover:text-pp-ink-blue',
              ].join(' ')}
            >
              {entry.text}
            </a>
          </li>
        )
      })}
    </ol>
  )
}

export default function PostToc({ entries }: { entries: TocEntry[] }) {
  const active = useActiveHeading(entries.map(entry => entry.id).join(' '))
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  const openDialog = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    // A modal dialog does not stop the page behind it from scrolling on touch devices.
    document.documentElement.style.overflow = 'hidden'
    setOpen(true)
  }, [])

  // Idempotent, because it runs both from our own handlers and from the dialog's `close`
  // event (Escape, or a close we triggered ourselves).
  const closeDialog = useCallback(() => {
    document.documentElement.style.overflow = ''
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    setOpen(false)
  }, [])

  // If the viewport grows past `lg` with the overlay open, the sticky column takes over.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => {
      if (query.matches) closeDialog()
    }
    query.addEventListener('change', onChange)
    return () => {
      query.removeEventListener('change', onChange)
      document.documentElement.style.overflow = ''
    }
  }, [closeDialog])

  if (entries.length === 0) return null

  return (
    <>
      <nav
        aria-labelledby="post-toc-heading"
        className="hidden lg:sticky lg:top-8 lg:block lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:pb-4"
      >
        <h2
          id="post-toc-heading"
          className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-ink-violet"
        >
          On this page
        </h2>
        <TocList
          entries={entries}
          active={active}
          size="compact"
        />
      </nav>

      <button
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="post-toc-dialog"
        className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-pp-line bg-[var(--pp-panel-strong)] px-4 py-2 font-display text-xs font-semibold uppercase tracking-[0.14em] text-pp-text shadow-[0_14px_32px_rgba(31,28,26,0.18)] backdrop-blur-md transition-transform motion-safe:hover:-translate-y-0.5 lg:hidden"
      >
        <List
          aria-hidden
          size={16}
        />
        Contents
      </button>

      <dialog
        id="post-toc-dialog"
        ref={dialogRef}
        aria-labelledby="post-toc-dialog-heading"
        onClose={closeDialog}
        className="fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none overflow-y-auto border-0 bg-[var(--pp-bg)] p-0 text-pp-text backdrop:bg-black/30 lg:hidden"
      >
        <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-gutter pb-10 pt-5">
          <div className="sticky top-0 -mx-gutter mb-4 flex items-center justify-between gap-4 bg-[var(--pp-bg)] px-gutter py-3">
            <h2
              id="post-toc-dialog-heading"
              className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-ink-violet"
            >
              On this page
            </h2>
            <button
              type="button"
              onClick={closeDialog}
              aria-label="Close contents"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-pp-line bg-[var(--pp-panel-strong)] text-pp-muted transition-colors hover:text-pp-text"
            >
              <X
                aria-hidden
                size={18}
              />
            </button>
          </div>
          {/* Closing first, then letting the anchor do its default jump: the page behind is
              scrollable again by the time the browser scrolls to the heading. */}
          <TocList
            entries={entries}
            active={active}
            size="large"
            onNavigate={closeDialog}
          />
        </div>
      </dialog>
    </>
  )
}
