'use client'

import { useEffect, useEffectEvent, useState } from 'react'

/**
 * The reader-side half of blog measurement: one view beacon, and a share button.
 *
 * ```
 *   mount ──▶ POST /api/blog/event { kind: 'view', slug, sessionId }
 *
 *   ?from=<token> in the URL
 *         └──▶ POST { kind: 'attribute', slug, token, sessionId }
 *
 *   [ Copy link ] click ──▶ mint token HERE  ──▶ POST { kind: 'share', slug, token }
 *                              │                 └──▶ clipboard: /blog/<slug>?from=<token>
 *                              ▼
 *                     NEVER during render
 * ```
 *
 * ## The share token is minted on the CLICK, and this is the whole reason the file is a
 * client component
 *
 * The tempting version mints it on the server while rendering the post, so the button has a
 * link ready. That is broken here in a specific and silent way: `/blog/<slug>` is ISR-cached
 * for 300 seconds, so the token generated during one render is **baked into the cached HTML**
 * and served to every subsequent reader.
 *
 * The consequence is not "shares are undercounted". It is that `blog:share:<token>` collapses
 * to a single document forever - every share of that post reuses one token - while
 * `blog:attribute:<token>:<session>` keeps growing correctly. So the board would show one
 * share and forty arrivals from it, and the shares number would be silently, permanently
 * wrong in a way that looks like a plausible ratio.
 *
 * Minting on the click also means a post nobody shares mints nothing, which is the correct
 * cost.
 *
 * ## `sessionId` lives in sessionStorage, and what that does and does not buy
 *
 * It de-duplicates one person refreshing a post, which is the only thing it is for. It is
 * per-tab, cleared when the tab closes, and never sent anywhere except in these beacons.
 *
 * It is NOT an identity and the code must not pretend otherwise: it is client-generated, so
 * anyone can send whatever they like. That is why `/blog/privacy` describes it honestly and
 * why the admin board labels unique readers as advisory. The blog's actual kill criterion
 * reads `ContactMessage.sourceSlug`, which requires a human to have written a sentence.
 *
 * ## Why every failure here is swallowed
 *
 * A measurement beacon must never produce a visible error on a post. The reader arriving from
 * a cross-post is the one this entire feature exists for, and a console full of red on their
 * first visit is a worse outcome than a missing row.
 */

const SESSION_KEY = 'blog-session'
/** Matches the server's `^[A-Za-z0-9_-]{1,64}$`, which excludes the `_id` separator. */
const TOKEN_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function mintToken(length = 16): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(
    bytes,
    byte => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]
  ).join('')
}

function sessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing

    const fresh = mintToken(20)
    window.sessionStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    // Private mode, or storage disabled. A per-load id still de-duplicates a refresh within
    // the same page view, which is most of the value, and costs nothing when it does not.
    return mintToken(20)
  }
}

async function send(body: Record<string, string>) {
  try {
    await fetch('/api/blog/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    })
  } catch {
    // Deliberately silent. See the header.
  }
}

export default function PostTracker({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)

  const beacon = useEffectEvent(() => {
    const session = sessionId()
    void send({ kind: 'view', slug, sessionId: session })

    // `?from=<token>` means this reader arrived through somebody's shared link. Recorded
    // against the token, so the board can say which post produced onward reach.
    const token = new URLSearchParams(window.location.search).get('from')
    if (token) void send({ kind: 'attribute', slug, token, sessionId: session })
  })

  useEffect(() => {
    const timer = window.setTimeout(() => beacon(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function share() {
    const token = mintToken()
    const url = `${window.location.origin}/blog/${slug}?from=${token}`

    // The mint is recorded before the link leaves, so a share always has its row even if the
    // clipboard write fails.
    void send({ kind: 'share', slug, token })

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard permission. The link is still valid and still counted; the reader can
      // copy the address bar. Not worth an error state on a post.
    }
  }

  return (
    <button
      onClick={() => void share()}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-pp-line px-5 py-2 text-sm font-semibold text-pp-text transition-colors hover:border-pp-blue/40"
    >
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  )
}
