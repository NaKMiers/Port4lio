'use client'

import { Check, Copy, Eye, Link2, Lock, Pencil } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import Spinner from '@/components/settings/Spinner'
import { sharePath } from '@/components/whiteboard/access'
import { cn } from '@/lib/utils'
import type { ClientBoard } from '@/lib/whiteboard/data'
import { SLUG_MAX, validateSlug, type ShareMode } from '@/lib/whiteboard/limits'

/**
 * The top bar's Share control, in its two shapes.
 *
 * ```
 *   owner   [Share ▾] ──▶ Who can open the link   Off | Can view | Can edit
 *                         Link name               /whiteboard/[q3-plan      ] [Save]
 *                         [Copy link]             (off: disabled - the link would 404)
 *
 *   shared  [Copy link]   nothing else: a visitor cannot change how the board is shared
 * ```
 *
 * Every change here is one PATCH the owner waits for (useBoards), not a save-queue write:
 * who can open a board is not something to hold in a debounce, and a slug that is taken
 * must come back as an error on this field, not as a refused write on the canvas pill.
 *
 * ## Why the link name is checked here as well as on the server
 *
 * `validateSlug` is the same function the route runs, so the field can say what is wrong
 * while the owner is still typing. The server stays the authority - it alone knows whether
 * another board already has the name, and answers 409 when it does.
 */

const MODES: {
  value: ShareMode
  label: string
  hint: string
  icon: ReactNode
}[] = [
  {
    value: 'off',
    label: 'Off',
    hint: 'Only you can open this board.',
    icon: (
      <Lock
        aria-hidden
        size={14}
      />
    ),
  },
  {
    value: 'view',
    label: 'Can view',
    hint: 'Anyone with the link can look, not change.',
    icon: (
      <Eye
        aria-hidden
        size={14}
      />
    ),
  },
  {
    value: 'edit',
    label: 'Can edit',
    hint: 'Anyone with the link can change this board.',
    icon: (
      <Pencil
        aria-hidden
        size={14}
      />
    ),
  },
]

const triggerCls =
  'inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-pp-line bg-white/85 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-text sm:px-3.5'

const primaryCls =
  'inline-flex min-h-[38px] items-center justify-center gap-2 rounded-full bg-pp-text px-4 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'

/** Copies `origin + path`, and says so for two seconds. False when the browser refused. */
function useCopyLink(path: string) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const url =
    typeof window === 'undefined' ? path : `${window.location.origin}${path}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setFailed(false)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard denied (an insecure origin, a browser setting): the URL is on screen to
      // select instead, which is the same fallback the Export sheet uses (DR4).
      setFailed(true)
    }
  }
  return { url, copy, copied, failed }
}

/** The shared canvas's Share: copy this page's link, and nothing else. */
export function CopyLinkButton({
  path,
  className,
}: {
  path: string
  className?: string
}) {
  const { url, copy, copied, failed } = useCopyLink(path)
  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Link copied' : 'Copy link'}
        title="Copy link"
        className={triggerCls}
      >
        {copied ? (
          <Check
            aria-hidden
            size={14}
          />
        ) : (
          <Link2
            aria-hidden
            size={14}
          />
        )}
        <span className="hidden sm:inline">
          {copied ? 'Copied' : 'Copy link'}
        </span>
      </button>
      {failed ? (
        <input
          readOnly
          value={url}
          aria-label="Board link"
          onFocus={event => event.currentTarget.select()}
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-72 rounded-xl border border-pp-line bg-pp-panel-strong px-3 py-2 text-[12.5px] text-pp-text shadow-panel"
        />
      ) : null}
    </div>
  )
}

/** The owner's Share menu. `board` is null until the board list has loaded. */
export function ShareMenu({
  board,
  open,
  onToggle,
  onChange,
  className,
}: {
  board: ClientBoard | null
  open: boolean
  onToggle: (open: boolean) => void
  /** One PATCH; rejects with the server's message (409 for a taken name). */
  onChange: (patch: {
    share?: ShareMode
    slug?: string | null
  }) => Promise<void>
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as HTMLElement))
        onToggle(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onToggle, open])

  const share = board?.share ?? 'off'

  return (
    <div
      ref={rootRef}
      // Below md the panel anchors to the header, like the Backup menu (TopBar).
      className={cn('md:relative', className)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={share === 'off' ? 'Share' : `Share (${share})`}
        title="Share"
        disabled={!board}
        onClick={() => onToggle(!open)}
        className={cn(triggerCls, 'disabled:opacity-50')}
      >
        <Link2
          aria-hidden
          size={14}
        />
        <span className="hidden xl:inline">Share</span>
        {share !== 'off' ? (
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-pp-blue"
          />
        ) : null}
      </button>
      {open && board ? (
        <SharePanel
          // A fresh draft per board, so the field never shows one board's name on another.
          key={board._id}
          board={board}
          onChange={onChange}
        />
      ) : null}
    </div>
  )
}

function SharePanel({
  board,
  onChange,
}: {
  board: ClientBoard
  onChange: (patch: {
    share?: ShareMode
    slug?: string | null
  }) => Promise<void>
}) {
  const [draft, setDraft] = useState(board.slug ?? '')
  const [busy, setBusy] = useState<null | 'share' | 'slug'>(null)
  const [error, setError] = useState<string | null>(null)
  const { url, copy, copied, failed } = useCopyLink(sharePath(board))

  const trimmed = draft.trim().toLowerCase()
  const dirty = trimmed !== (board.slug ?? '')
  const draftCheck = trimmed ? validateSlug(trimmed) : null
  const draftError = draftCheck && !draftCheck.ok ? draftCheck.error : null

  const run = async (
    which: 'share' | 'slug',
    patch: { share?: ShareMode; slug?: string | null }
  ) => {
    setBusy(which)
    setError(null)
    try {
      await onChange(patch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(null)
    }
  }

  const saveSlug = () => {
    if (!dirty || draftError) return
    void run('slug', { slug: trimmed || null })
  }

  const labelCls =
    'font-display text-[10.5px] font-semibold uppercase tracking-[0.13em] text-pp-muted'

  return (
    <div
      role="dialog"
      aria-label="Share this board"
      data-testid="wb-share-panel"
      className="absolute right-0 top-[calc(100%+8px)] z-40 flex w-[min(22rem,calc(100vw-1rem))] flex-col gap-3.5 rounded-2xl border border-pp-line bg-pp-panel-strong p-3.5 shadow-panel max-md:right-2"
    >
      <div
        role="radiogroup"
        aria-label="Who can open the link"
        className="flex flex-col gap-1.5"
      >
        <p className={labelCls}>Who can open the link</p>
        {MODES.map(mode => {
          const active = board.share === mode.value
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy !== null}
              onClick={() => {
                if (!active) void run('share', { share: mode.value })
              }}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition',
                active
                  ? 'border-pp-text bg-white'
                  : 'border-pp-line bg-white/60 hover:bg-white'
              )}
            >
              <span className="mt-0.5 text-pp-muted">{mode.icon}</span>
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold text-pp-text">
                  {mode.label}
                </span>
                <span className="text-[11.5px] text-pp-muted">{mode.hint}</span>
              </span>
              {active ? (
                <Check
                  aria-hidden
                  size={14}
                  className="ml-auto mt-0.5 text-pp-text"
                />
              ) : null}
            </button>
          )
        })}
      </div>

      {board.share === 'edit' && board.includeInAi ? (
        <p className="rounded-xl bg-pp-ink-amber/10 px-3 py-2 text-[12px] text-pp-ink-amber">
          Your agents can read this board, so what people write through the link
          reaches them too. Hide the board from AI (board name menu) if that is
          not what you want.
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="wb-share-slug"
          className={labelCls}
        >
          Link name
        </label>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded-xl border border-pp-line bg-white px-2.5 focus-within:border-pp-text">
            <span className="shrink-0 text-[12.5px] text-pp-muted">
              /whiteboard/
            </span>
            <input
              id="wb-share-slug"
              value={draft}
              maxLength={SLUG_MAX}
              placeholder={board._id}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={Boolean(draftError)}
              aria-describedby="wb-share-slug-hint"
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  saveSlug()
                }
              }}
              className="min-w-0 flex-1 bg-transparent py-2 text-[12.5px] text-pp-text outline-none placeholder:text-pp-muted/60"
            />
          </div>
          <button
            type="button"
            onClick={saveSlug}
            disabled={!dirty || Boolean(draftError) || busy !== null}
            className={cn(primaryCls, 'min-h-[36px] px-3.5')}
          >
            {busy === 'slug' ? <Spinner size={13} /> : 'Save'}
          </button>
        </div>
        <p
          id="wb-share-slug-hint"
          className={cn(
            'text-[11.5px]',
            draftError ? 'text-pp-ink-rose' : 'text-pp-muted'
          )}
        >
          {draftError ??
            'Empty uses the board id. A short, common name is easy to guess. Renaming breaks links that used the old name - the id link keeps working.'}
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="text-[12px] text-pp-ink-rose"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={copy}
          disabled={board.share === 'off'}
          data-testid="wb-share-copy"
          className={primaryCls}
        >
          {copied ? (
            <Check
              aria-hidden
              size={14}
            />
          ) : (
            <Copy
              aria-hidden
              size={14}
            />
          )}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {board.share === 'off' ? (
          <p className="text-center text-[11.5px] text-pp-muted">
            Turn sharing on to use the link.
          </p>
        ) : failed ? (
          <input
            readOnly
            value={url}
            aria-label="Board link"
            onFocus={event => event.currentTarget.select()}
            className="rounded-xl border border-pp-line bg-white px-3 py-2 text-[12.5px] text-pp-text"
          />
        ) : null}
      </div>
    </div>
  )
}
