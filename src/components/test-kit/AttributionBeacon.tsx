'use client'

import { useEffect, useRef } from 'react'

import { clientSessionId } from '@/lib/client-session'
import { TOKEN_LENGTH } from '@/lib/tokens'

/**
 * Records that this visit came from a shared link.
 *
 * ```
 *   /vi/mbti/enfj?s=<shareToken>     ← STATIC page, served from cache
 *            │
 *      mount, read ?s=
 *            │
 *   POST /api/event {kind:'attribute', shareToken, sessionId}
 *            │
 *   testEvents  mbti:attribute:<shareToken>:<sessionId>   ← upsert, so refresh is free
 * ```
 *
 * ## Why this is client-side and not a server read
 *
 * The type pages are `force-static` with `dynamicParams: false`. Reading `searchParams`
 * server-side opts a page into dynamic rendering, which would drop prerendering and CDN
 * caching on all 32 type/locale pages - the entire indexable surface of this product -
 * in exchange for a metric that only needs to be directionally right.
 *
 * `window.location.search` in an effect rather than `useSearchParams`: this is a pure
 * side effect that renders nothing, and `useSearchParams` under `force-static` requires a
 * Suspense boundary and risks a static deopt. Reading the location directly has neither
 * problem and is honest about what it is.
 *
 * The cost is real and worth naming: visitors with JavaScript off or an aggressive blocker
 * are not counted. Attribution therefore undercounts, never over-counts, which is the
 * right direction for a number used to decide whether a loop works.
 */
export default function AttributionBeacon({ product }: { product: string }) {
  // Guards the double-invoke React StrictMode does in development. The upsert makes it
  // harmless either way; this just avoids the pointless second request.
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return

    const shareToken = new URLSearchParams(window.location.search).get('s')
    // Shape-check here too, so an obviously bogus `?s=` never costs a request. The server
    // checks again - this is a courtesy, not the control.
    if (
      !shareToken ||
      !/^[A-Za-z0-9_-]+$/.test(shareToken) ||
      shareToken.length !== TOKEN_LENGTH
    )
      return

    sent.current = true
    void fetch('/api/event', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product,
        kind: 'attribute',
        shareToken,
        sessionId: clientSessionId(),
      }),
      // Swallowed on purpose. A visitor who followed a friend's link must never see an
      // error because a counter was unreachable.
    }).catch(() => {})
  }, [product])

  return null
}
