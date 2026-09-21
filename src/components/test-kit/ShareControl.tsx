'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ShareControlCopy = {
  /** Button label at rest. */
  share: string
  /** Confirmation after the link reached the clipboard. */
  copied: string
  /** Shown above the fallback input when neither share nor clipboard worked. */
  copyManually: string
}

type Props = {
  product: string
  shareToken: string
  /** The public artifact the link points at. Recorded for the share row, never trusted. */
  type: string
  /** Absolute or root-relative URL to share. Must never contain a result token. */
  url: string
  /** Native share sheet title and text, where the platform supports them. */
  title: string
  text: string
  copy: ShareControlCopy
  className?: string
}

type State = 'idle' | 'busy' | 'copied' | 'manual'

/**
 * The share control.
 *
 * ```
 *   tap ──▶ navigator.share ──── ok ────▶ record + idle
 *              │      │
 *              │      └── AbortError ──▶ idle           (user cancelled: NOT a failure)
 *              │
 *          unavailable
 *              │
 *              ▼
 *       clipboard.writeText ─── ok ────▶ record + "copied"
 *              │
 *          rejected (insecure context, WebView policy)
 *              │
 *              ▼
 *        reveal a selectable input ────▶ "copy manually"
 * ```
 *
 * ## Why three levels and not one
 *
 * The visitors this loop depends on are inside Zalo and Facebook in-app browsers, and
 * those WebViews are inconsistent about both APIs: `navigator.share` may be missing, and
 * `navigator.clipboard` rejects outside a secure context and under some WebView policies.
 * A control that silently does nothing in the one app where sharing actually happens is
 * not a share button, it is a button.
 *
 * ## AbortError is a normal outcome
 *
 * Cancelling the OS share sheet rejects with `AbortError`. Treating that as a failure
 * would show an error to someone who simply changed their mind, and would log noise that
 * looks like a bug. It returns to idle and records nothing.
 *
 * ## The URL never carries a credential
 *
 * `url` points at an already-public page (`/[lang]/mbti/<type>?s=<shareToken>`). Result
 * URLs *are* credentials - see `lib/tokens.ts` - so pasting one into a group chat would
 * give away the paid result to everyone in it. The share token is opaque and separate.
 */
export default function ShareControl({
  product,
  shareToken,
  type,
  url,
  title,
  text,
  copy,
  className,
}: Props) {
  const [state, setState] = useState<State>('idle')
  const [absolute, setAbsolute] = useState(url)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), 2_500)
    return () => clearTimeout(timer)
  }, [state])

  /**
   * Fire-and-forget. `keepalive` so the write survives the page being backgrounded by the
   * share sheet, and a swallowed rejection because a failed counter must never surface to
   * someone who just successfully shared something.
   */
  const record = useCallback(() => {
    void fetch('/api/event', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, kind: 'share', shareToken, type }),
    }).catch(() => {})
  }, [product, shareToken, type])

  const onClick = useCallback(async () => {
    setState('busy')

    // Absolutised here rather than in an effect. A relative URL works for the clipboard
    // but reads badly once pasted, and `window` does not exist during SSR - a click is the
    // first moment both are true, so it is the right moment to resolve it.
    const shareUrl = new URL(url, window.location.origin).toString()
    setAbsolute(shareUrl)

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    )
      try {
        await navigator.share({ title, text, url: shareUrl })
        record()
        setState('idle')
        return
      } catch (error) {
        // The user closing the sheet is not an error. Anything else falls through to the
        // clipboard rather than dead-ending.
        if (error instanceof Error && error.name === 'AbortError') {
          setState('idle')
          return
        }
      }

    try {
      await navigator.clipboard.writeText(shareUrl)
      record()
      setState('copied')
      return
    } catch {
      // Insecure context or a WebView that refuses clipboard access. Show the link so it
      // can be selected by hand - the loop still works, it just needs one more tap.
      //
      // Recorded here too, and that is deliberate. The visitor asked to share and the link
      // is now in front of them; the only thing that failed is an API. Not counting this
      // would blind the metric precisely where the fallback matters most - locked-down
      // in-app WebViews, which is where these visitors actually are.
      record()
      setState('manual')
      // Select on the next frame, once the input has actually rendered.
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [record, text, title, url])

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'busy'}
        aria-live="polite"
        className="inline-flex items-center gap-2.5 rounded-full border border-pp-line px-7 py-3.5 font-display text-sm font-semibold uppercase tracking-[0.16em] text-pp-text transition hover:-translate-y-0.5 disabled:opacity-60 motion-reduce:hover:translate-y-0"
      >
        {state === 'copied' ? copy.copied : copy.share}
      </button>

      {state === 'manual' ? (
        <div className="mt-3">
          <label
            className="block text-xs text-pp-muted"
            htmlFor="share-url"
          >
            {copy.copyManually}
          </label>
          <input
            ref={inputRef}
            id="share-url"
            readOnly
            value={absolute}
            onFocus={event => event.currentTarget.select()}
            className="mt-1 w-full rounded-lg border border-pp-line bg-transparent px-3 py-2 text-sm text-pp-text"
          />
        </div>
      ) : null}
    </div>
  )
}
