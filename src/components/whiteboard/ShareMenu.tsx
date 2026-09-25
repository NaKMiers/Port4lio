'use client'

import { Check, Copy, Eye, EyeOff, KeyRound, Link2, Pencil } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import ToggleSwitch from '@/components/blog-admin/ToggleSwitch'
import Spinner from '@/components/settings/Spinner'
import { sharePath } from '@/components/whiteboard/access'
import { cn } from '@/lib/utils'
import type { ClientBoard } from '@/lib/whiteboard/data'
import {
  SHARE_PASSWORD_MAX,
  SHARE_UNLOCK_LABELS,
  SHARE_UNLOCK_TTLS,
  SLUG_MAX,
  validateSharePassword,
  validateSlug,
  type SharePatch,
  type ShareMode,
  type ShareUnlockTtl,
} from '@/lib/whiteboard/limits'
import { getBoardPasswordApi } from '@/requests/whiteboard'

/**
 * The top bar's Share control, in its two shapes.
 *
 * ```
 *   owner   [Share ▾] ──▶ • Not shared / Shared - anyone with the link can view
 *                         Anyone with the link    Can view | Can edit
 *                         Link                    /whiteboard/[q3-plan      ] [copy]
 *                         Require a password      [OFF|ON]
 *                           on:  [••••••            (eye)]
 *                                Stay unlocked for  10m 1h [1d] 2d 7d 30d Unlimited
 *                         ──────────────────────────────────────────────
 *                         not shared:  [          Share          ]
 *                         shared:      [Unshare] [     Update     ]
 *
 *   shared  [Copy link]   nothing else: a visitor cannot change how the board is shared
 * ```
 *
 * ## Nothing applies until the button
 *
 * Every field above the line is a draft. Share (or Update, once shared) sends the fields
 * that differ from the board in ONE PATCH, and Unshare sends `share: 'off'` alone. It used to
 * apply each choice as it was made, which meant picking "Can edit" on the way to setting a
 * password opened the board to editing - with no password yet - for as long as that took.
 * One button also means the owner sees the whole of what they are about to publish before
 * any of it is live. Each change is one PATCH the owner waits for (useBoards), not a
 * save-queue write: a slug that is taken must come back as an error here, not as a refused
 * write on the canvas pill.
 *
 * The copy button copies the SAVED link, so it is off until the board is shared and while the
 * link name has an edit that Update has not sent yet - a draft name is not a link anyone can
 * open.
 *
 * ## The password
 *
 * Optional, and off by default: with none set the link alone opens the board, as it always
 * did. Once set, a visitor types it once and stays in for "Stay unlocked for", counted from
 * when they typed it. Setting a new password, or removing it, signs every visitor out at
 * once, whatever time they had left (share-password.ts). The field holds the saved password
 * itself, fetched when the panel opens from an owner-only route (the board list never
 * carries it), so the eye button shows it and changing it is editing it. It is sent again
 * only if it changed: the same password re-sent would still sign every visitor out.
 *
 * With the switch on the field may never be empty - Share / Update stays off and the field
 * says why. An empty field with the switch on is exactly the state that locked a link behind
 * a password nobody knew. A password saved before copies were kept (or under a rotated
 * `AUTH_SECRET`) loads as empty, so it has to be typed again before anything else saves.
 *
 * Whether the link asks for one is the "Require a password" switch, never whether the field
 * happens to hold text. It used to be the field: a password field is exactly what a browser
 * autofills with the owner's saved login, so a Share pressed on a board the owner never meant
 * to lock sent that login as the link's password - and visitors got a form for a password
 * nobody had set. Now the field only exists with the switch on, starts read-only until it is
 * focused (autofill skips read-only fields), and has a show button so what is in it can be
 * checked. With the switch on and no password saved, Share waits until one is typed: a lock
 * with nothing behind it is the one state this must never publish. Switching it off on a
 * board that has one is how the password comes off.
 *
 * The TTL is chips rather than a `SelectField`: that list portals to `document.body`, and
 * this panel's outside-press handler would read a press on an option as a press outside and
 * close the whole menu under it. Seven short options fit a row anyway.
 *
 * ## Why the link name is checked here as well as on the server
 *
 * `validateSlug` is the same function the route runs, so the field can say what is wrong
 * while the owner is still typing. The server stays the authority - it alone knows whether
 * another board already has the name, and answers 409 when it does.
 */

/** Who the link lets in once it is on. Off is not a choice here: it is the Unshare button. */
type LinkMode = Exclude<ShareMode, 'off'>

const MODES: {
  value: LinkMode
  label: string
  hint: string
  icon: ReactNode
}[] = [
  {
    value: 'view',
    label: 'Can view',
    hint: 'Look, not change.',
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
    hint: 'Change this board.',
    icon: (
      <Pencil
        aria-hidden
        size={14}
      />
    ),
  },
]

const triggerCls =
  'inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-pp-line bg-white/85 px-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-text xl:px-3.5'

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
  onChange: (patch: SharePatch) => Promise<void>
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
      // Below md the panel anchors to the header, like the Backup menu, and the trigger is
      // gone: the top bar's More menu opens it (TopBar). `contents` so the empty box takes
      // no gap in the row.
      className={cn('max-md:contents md:relative', className)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={share === 'off' ? 'Share' : `Share (${share})`}
        title="Share"
        disabled={!board}
        onClick={() => onToggle(!open)}
        className={cn(triggerCls, 'disabled:opacity-50 max-md:hidden')}
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
  onChange: (patch: SharePatch) => Promise<void>
}) {
  const shared = board.share !== 'off'
  // Everything below is a draft until Share / Update / Unshare (see the header).
  const [mode, setMode] = useState<LinkMode>(
    board.share === 'edit' ? 'edit' : 'view'
  )
  const [draft, setDraft] = useState(board.slug ?? '')
  // The switch, not the field, decides whether the link asks for a password (see header).
  const [requirePassword, setRequirePassword] = useState(board.passwordSet)
  // The field holds the password itself: the saved one once it has loaded, or a new one.
  const [password, setPassword] = useState('')
  /**
   * The saved password, fetched when the panel opens. `undefined` while loading, `null` for
   * none - or one whose copy cannot be read back, which then has to be typed again.
   */
  const [saved, setSaved] = useState<string | null | undefined>(
    board.passwordSet ? undefined : null
  )
  const [touched, setTouched] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Read-only until the owner focuses it, so a browser cannot autofill a saved password in.
  const [passwordArmed, setPasswordArmed] = useState(false)
  const [ttl, setTtl] = useState<ShareUnlockTtl>(board.unlockTtl)
  const [busy, setBusy] = useState<null | 'apply' | 'unshare'>(null)
  const [error, setError] = useState<string | null>(null)
  const { url, copy, copied, failed } = useCopyLink(sharePath(board))

  const trimmed = draft.trim().toLowerCase()
  const slugDirty = trimmed !== (board.slug ?? '')
  const draftCheck = trimmed ? validateSlug(trimmed) : null
  const draftError = draftCheck && !draftCheck.ok ? draftCheck.error : null

  const loadingPassword = requirePassword && saved === undefined
  // A switched-on lock with no password behind it would ask visitors for one that does not
  // exist, so with the switch on the field may never be empty (see the header).
  const emptyPassword = requirePassword && !loadingPassword && !password
  const passwordCheck = password ? validateSharePassword(password) : null
  const passwordError = emptyPassword
    ? "The password can't be empty."
    : passwordCheck && !passwordCheck.ok
      ? passwordCheck.error
      : null

  /** The fields that differ from the board: what Share / Update sends, and nothing else. */
  const patch: SharePatch = {}
  if (!shared || mode !== board.share) patch.share = mode
  if (slugDirty) patch.slug = trimmed || null
  if (!requirePassword) {
    if (board.passwordSet) patch.password = null
  } else {
    // Only a password that differs from the saved one is sent: sending the same one again
    // would still be a new access version, and sign every visitor out for nothing.
    if (password && password !== saved) patch.password = password
    if (ttl !== board.unlockTtl) patch.unlockTtl = ttl
  }
  const dirty = Object.keys(patch).length > 0
  // A saved password this panel cannot show: it must be typed again (see the header).
  const unreadable = board.passwordSet && requirePassword && saved === null
  // Empty is always refused, but only said in red once it is not simply a fresh switch-on.
  const shownPasswordError =
    passwordError && (!emptyPassword || touched || board.passwordSet)
      ? passwordError
      : null
  const invalid = Boolean(
    draftError || (requirePassword && passwordError) || loadingPassword
  )

  useEffect(() => {
    if (!board.passwordSet) return
    let cancelled = false
    getBoardPasswordApi(board._id)
      .then(result => {
        if (cancelled) return
        setSaved(result.password)
        // Only into an untouched field: a password typed while this loaded is the owner's.
        setPassword(current => current || (result.password ?? ''))
      })
      .catch(() => {
        if (!cancelled) setSaved(null)
      })
    return () => {
      cancelled = true
    }
    // Once per panel: the panel is keyed by board, and a save updates `saved` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = async (which: 'apply' | 'unshare', body: SharePatch) => {
    setBusy(which)
    setError(null)
    try {
      await onChange(body)
      // Saved: what the field holds is now the board's password (or there is none).
      if (body.password === null) {
        setSaved(null)
        setPassword('')
      } else if (body.password !== undefined) setSaved(body.password)
      setTouched(false)
      setShowPassword(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(null)
    }
  }

  const submit = () => {
    if (!dirty || invalid || busy) return
    void apply('apply', patch)
  }

  const labelCls =
    'font-display text-[10.5px] font-semibold uppercase tracking-[0.13em] text-pp-muted'

  return (
    <div
      role="dialog"
      aria-label="Share this board"
      data-testid="wb-share-panel"
      className="absolute right-0 top-[calc(100%+8px)] z-40 flex max-h-[calc(100dvh-5rem)] w-[min(22rem,calc(100vw-1rem))] flex-col gap-3.5 overflow-y-auto rounded-2xl border border-pp-line bg-pp-panel-strong p-3.5 shadow-panel max-md:right-2"
    >
      <p
        data-testid="wb-share-state"
        className="flex items-center gap-2 text-[12.5px] text-pp-text"
      >
        <span
          aria-hidden
          className={cn(
            'h-[7px] w-[7px] rounded-full',
            shared ? 'bg-pp-green' : 'bg-pp-muted/50'
          )}
        />
        {shared
          ? `Shared - anyone with the link can ${board.share === 'edit' ? 'edit' : 'view'}${board.passwordSet ? ', with the password' : ''}.`
          : 'Not shared. Only you can open this board.'}
      </p>

      <div
        role="radiogroup"
        aria-label="Who can open the link"
        className="flex flex-col gap-1.5"
      >
        <p className={labelCls}>Anyone with the link</p>
        {MODES.map(option => {
          const active = mode === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy !== null}
              onClick={() => setMode(option.value)}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition',
                active
                  ? 'border-pp-text bg-white'
                  : 'border-pp-line bg-white/60 hover:bg-white'
              )}
            >
              <span className="mt-0.5 text-pp-muted">{option.icon}</span>
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold text-pp-text">
                  {option.label}
                </span>
                <span className="text-[11.5px] text-pp-muted">
                  {option.hint}
                </span>
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

      {mode === 'edit' && board.includeInAi ? (
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
          Link
        </label>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded-xl border border-pp-line bg-white px-2.5 focus-within:border-pp-text">
            <span className="shrink-0 text-[12.5px] text-pp-muted">
              /whiteboard/
            </span>
            <input
              id="wb-share-slug"
              aria-label="Link name"
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
                  submit()
                }
              }}
              className="min-w-0 flex-1 bg-transparent py-2 text-[12.5px] text-pp-text outline-none placeholder:text-pp-muted/60"
            />
          </div>
          <button
            type="button"
            onClick={copy}
            // The saved link, and only once it opens: a draft name is not a link yet.
            disabled={!shared || slugDirty}
            aria-label={copied ? 'Link copied' : 'Copy link'}
            title={
              !shared
                ? 'Share the board to copy its link'
                : slugDirty
                  ? 'Update first: the new name is not the link yet'
                  : 'Copy link'
            }
            data-testid="wb-share-copy"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-pp-line bg-white text-pp-text transition hover:bg-pp-text/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? (
              <Check
                aria-hidden
                size={15}
              />
            ) : (
              <Copy
                aria-hidden
                size={15}
              />
            )}
          </button>
        </div>
        {failed ? (
          <input
            readOnly
            value={url}
            aria-label="Board link"
            onFocus={event => event.currentTarget.select()}
            className="rounded-xl border border-pp-line bg-white px-3 py-2 text-[12.5px] text-pp-text"
          />
        ) : null}
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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span
            id="wb-share-lock-label"
            className="text-[13px] font-semibold text-pp-text"
          >
            Require a password
          </span>
          <ToggleSwitch
            id="wb-share-lock"
            checked={requirePassword}
            disabled={busy !== null}
            onChange={on => {
              setRequirePassword(on)
              // Back on, the saved password comes back into the field; off, the field goes.
              setPassword(on ? (saved ?? '') : '')
              setTouched(false)
              setShowPassword(false)
            }}
          />
        </div>
        {requirePassword ? (
          <>
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-pp-line bg-white px-2.5 focus-within:border-pp-text">
              <KeyRound
                aria-hidden
                size={13}
                className="shrink-0 text-pp-muted"
              />
              <input
                id="wb-share-password"
                aria-label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                readOnly={!passwordArmed}
                // Armed on the press as well as the focus: a phone taps a read-only field and
                // would otherwise want a second tap before its keyboard opened.
                onPointerDown={() => setPasswordArmed(true)}
                onFocus={() => setPasswordArmed(true)}
                maxLength={SHARE_PASSWORD_MAX}
                placeholder={
                  loadingPassword
                    ? 'Loading...'
                    : 'The password visitors will type'
                }
                // Belt and braces against autofill: the owner's saved login is the one thing
                // this field must never receive, and a silent fill would lock the link.
                autoComplete="new-password"
                name="wb-share-link-password"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                aria-invalid={Boolean(passwordError)}
                aria-describedby="wb-share-password-hint"
                disabled={loadingPassword}
                onChange={event => {
                  setPassword(event.target.value)
                  setTouched(true)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                }}
                className="min-w-0 flex-1 bg-transparent py-2 text-[12.5px] text-pp-text outline-none placeholder:text-pp-muted/60"
              />
              <button
                type="button"
                onClick={() => setShowPassword(on => !on)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide' : 'Show'}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-pp-muted hover:bg-pp-text/5 hover:text-pp-text"
              >
                {showPassword ? (
                  <EyeOff
                    aria-hidden
                    size={14}
                  />
                ) : (
                  <Eye
                    aria-hidden
                    size={14}
                  />
                )}
              </button>
            </div>
            <p
              id="wb-share-password-hint"
              data-testid="wb-share-password-state"
              className={cn(
                'text-[11.5px]',
                shownPasswordError ? 'text-pp-ink-rose' : 'text-pp-muted'
              )}
            >
              {unreadable && !password
                ? 'It was saved before it could be shown again. Type it again, or a new one.'
                : (shownPasswordError ??
                  (board.passwordSet
                    ? 'Visitors type it once. Changing it signs everyone out.'
                    : 'Type the password visitors will need.'))}
            </p>
          </>
        ) : (
          <p
            data-testid="wb-share-password-state"
            className="text-[11.5px] text-pp-muted"
          >
            {board.passwordSet
              ? 'The password comes off when you update, and everyone with the link gets straight in.'
              : 'Off. The link alone opens the board.'}
          </p>
        )}
      </div>

      {requirePassword ? (
        <div
          role="radiogroup"
          aria-label="Stay unlocked for"
          className="flex flex-col gap-1.5"
        >
          <p className={labelCls}>Stay unlocked for</p>
          <div className="flex flex-wrap gap-1.5">
            {SHARE_UNLOCK_TTLS.map(value => {
              const active = ttl === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={SHARE_UNLOCK_LABELS[value]}
                  title={SHARE_UNLOCK_LABELS[value]}
                  disabled={busy !== null}
                  onClick={() => setTtl(value)}
                  className={cn(
                    'min-h-[30px] rounded-full border px-2.5 font-display text-[11px] font-semibold tracking-[0.04em] transition disabled:opacity-60',
                    active
                      ? 'border-pp-text bg-pp-text text-white'
                      : 'border-pp-line bg-white/70 text-pp-text hover:bg-white'
                  )}
                >
                  {value === 'unlimited' ? 'Unlimited' : value}
                </button>
              )
            })}
          </div>
          <p className="text-[11.5px] text-pp-muted">
            Counted from when each visitor typed it. A shorter time applies to
            visitors already in.
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="text-[12px] text-pp-ink-rose"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2 border-t border-pp-line pt-3">
        {shared ? (
          <button
            type="button"
            onClick={() => void apply('unshare', { share: 'off' })}
            disabled={busy !== null}
            data-testid="wb-share-unshare"
            className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-full border border-pp-line bg-white px-4 text-[12.5px] font-semibold text-pp-ink-rose transition hover:bg-pp-pink/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'unshare' ? <Spinner size={13} /> : null}
            Unshare
          </button>
        ) : null}
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || invalid || busy !== null}
          data-testid="wb-share-apply"
          className={cn(primaryCls, 'flex-1')}
        >
          {busy === 'apply' ? <Spinner size={13} /> : null}
          {shared ? 'Update' : 'Share'}
        </button>
      </div>
    </div>
  )
}
