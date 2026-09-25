'use client'

import { Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  inputCls,
  labelCls,
  primaryBtnCls,
} from '@/components/settings/settings-utils'
import Spinner from '@/components/settings/Spinner'
import { SHARE_PASSWORD_MAX } from '@/lib/whiteboard/limits'
import { cn } from '@/lib/utils'

/**
 * What a share link shows in place of the board while it needs its password
 * (`/whiteboard/<key>`, WhiteboardBoard.ts).
 *
 * ```
 *   [password] [Open] ──▶ POST .../unlock ── 200 ──▶ router.refresh(): the page re-renders
 *                                         │          on the server, with the cookie, as the board
 *                                         └─ 4xx ──▶ the server's message under the field
 * ```
 *
 * It names nothing about the board - not its title, not how long the password lasts - so a
 * link that leaked says only that there is something behind it. `key` is the part of the URL
 * the visitor used, slug or id, so the unlock resolves the same board the page did.
 */
export default function SharePasswordForm({
  boardKey,
  className,
}: {
  boardKey: string
  className?: string
}) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/whiteboard/shared/${encodeURIComponent(boardKey)}/unlock`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        }
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        setError(body.error ?? `Could not open the board (${res.status}).`)
        setBusy(false)
        return
      }
      // Stays busy: the refresh swaps this form for the board.
      router.refresh()
    } catch {
      setError('Could not reach the server. Check the connection and retry.')
      setBusy(false)
    }
  }

  return (
    <main
      className={cn(
        'grid min-h-[100dvh] w-full place-items-center p-6',
        className
      )}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-panel border border-pp-line bg-pp-panel-strong p-6 shadow-panel"
      >
        <span className="grid h-10 w-10 place-items-center rounded-full border border-pp-line bg-white/80 text-pp-muted">
          <Lock
            aria-hidden
            size={16}
          />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-[-0.02em] text-pp-text">
          This board needs a password.
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-pp-muted">
          Ask whoever shared the link for it.
        </p>
        <label
          htmlFor="wb-share-password"
          className={cn(labelCls, 'mt-5')}
        >
          Password
        </label>
        <input
          id="wb-share-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          maxLength={SHARE_PASSWORD_MAX}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'wb-share-password-error' : undefined}
          onChange={event => setPassword(event.target.value)}
          className={inputCls}
        />
        {error ? (
          <p
            id="wb-share-password-error"
            role="alert"
            className="mt-2 text-[13px] text-pp-ink-rose"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!password || busy}
          className={cn(primaryBtnCls, 'mt-5 w-full gap-2')}
        >
          {busy ? <Spinner size={14} /> : null}
          Open the board
        </button>
      </form>
    </main>
  )
}
