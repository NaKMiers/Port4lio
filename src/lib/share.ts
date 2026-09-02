import { connectDatabase } from '@/lib/mongodb'
import { recordEvent } from '@/lib/test-events'
import { isTokenShaped, mintToken } from '@/lib/tokens'
import { TestEventModel, testEventId } from '@/models/TestEvent'

/**
 * The share loop, for any test.
 *
 * ```
 *   result page ──▶ mintShare(product, {type})
 *                        │  returns an OPAQUE share token
 *                        ▼
 *          /vi/mbti/enfj?s=<shareToken>          ◀── what actually gets pasted
 *                        │
 *          recipient opens it, client beacon fires
 *                        ▼
 *              recordAttribution(product, shareToken, sessionId)
 * ```
 *
 * ## The share token is not the result token
 *
 * `lib/tokens.ts` is explicit that a result URL *is* a credential: holding
 * `/vi/mbti/result/<token>` is the entire proof that the result is yours. So nothing that
 * gets pasted into a group chat may contain one. A shared link that leaked the result
 * token would give away paid content to everyone in the chat, and - because an
 * `opengraph-image` route lives at a different URL than its page and inherits no `robots`
 * directive - would put a live credential somewhere a crawler can index it, permanently.
 *
 * The share token is therefore a separate, opaque id. It maps to `{product, type}` and
 * nothing else. Resolving it tells you a share happened; it never opens a result.
 *
 * Shares point at pages that are already public and already carry prerendered cards
 * (`/[lang]/mbti/<type>`), so there is no new image route to cache, rate-limit or leak.
 *
 * ## Product-agnostic on purpose
 *
 * `product` is a parameter, not a filename. The IQ test inherits this whole loop rather
 * than growing a second copy - which is the mistake `mbtiPayments`, `fulfilMbtiPayment`
 * and `MbtiChrome` already made in this codebase, and which costs a rename every time a
 * second product appears.
 */

export type ShareOrigin = {
  product: string
  /** The public artifact the share points at - an MBTI type today, a score band later. */
  type: string
}

/**
 * A fresh share token, minted at render.
 *
 * Deliberately does NOT write anything. A token handed to a page nobody shares should
 * leave no trace - recording at render would count every result view as a share and
 * inflate the one number this whole feature exists to produce. The row is written when
 * the visitor actually taps share, by `recordShare` below.
 */
export function mintShareToken(): string {
  return mintToken()
}

/**
 * Record that a share actually happened.
 *
 * The token round-trips through the client, which is safe: it is opaque, it is theirs, and
 * it maps only to a type they are already looking at. `isTokenShaped` bounds it before it
 * becomes part of a document `_id`.
 */
export async function recordShare(
  product: string,
  shareToken: string,
  origin: Omit<ShareOrigin, 'product'>
): Promise<void> {
  if (!isTokenShaped(shareToken)) return
  await recordEvent({
    id: testEventId.share(product, shareToken),
    product,
    kind: 'share',
    clientReported: true,
    data: { type: origin.type },
  })
}

/**
 * Look up where an inbound `?s=` came from.
 *
 * `isTokenShaped` first so a scan for `?s=../../etc/passwd` or a 10KB query string never
 * becomes a database query. Returns `null` for anything unknown - a stale or invented
 * token must render the page normally, never an error: the visitor did nothing wrong and
 * has no idea a token was involved.
 */
export async function resolveShare(product: string, shareToken: string): Promise<ShareOrigin | null> {
  if (!isTokenShaped(shareToken)) return null

  try {
    await connectDatabase()
    const doc = await TestEventModel.findById(testEventId.share(product, shareToken)).lean()
    if (!doc) return null
    const type = doc.data?.type
    return { product, type: typeof type === 'string' ? type : '' }
  } catch (error) {
    console.error('[share] resolve failed', error)
    return null
  }
}

/**
 * Record that someone arrived via a shared link.
 *
 * Keyed on `(shareToken, sessionId)` so the same visitor is counted once no matter how
 * many times the beacon fires - StrictMode double-invokes it in development, a refresh
 * re-runs it, and a back-navigation re-mounts the component. Without that key the share
 * rate reads high for no reason, which is the one failure here that would be believed.
 */
export async function recordAttribution(
  product: string,
  shareToken: string,
  sessionId: string
): Promise<void> {
  if (!isTokenShaped(shareToken)) return
  await recordEvent({
    id: testEventId.attribute(product, shareToken, sessionId),
    product,
    kind: 'attribute',
    clientReported: true,
    data: { shareToken },
  })
}
