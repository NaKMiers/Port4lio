import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

/**
 * Drop every image URL that does not come from this site's own Cloudinary account.
 *
 * ```
 *   img[src] · img[longdesc] · source[srcset]
 *        │
 *        ▼
 *   new URL(value)  ──throws──▶ DROP          ← //evil.com/x.png lands here
 *        │
 *        ├─ protocol !== 'https:'     ──▶ DROP
 *        ├─ hostname !== the literal  ──▶ DROP
 *        ├─ username or password set  ──▶ DROP
 *        └─ path not /<cloud>/…       ──▶ DROP
 *                    │
 *                    ▼
 *                  KEEP
 * ```
 *
 * ## Why a separate visitor and not a schema rule
 *
 * `rehype-sanitize`'s `protocols` option constrains **schemes**, not **hostnames**. Setting
 * `src: ['https']` makes `https://evil.com/tracker.png` *pass*, because the scheme is https
 * and that is the only question the option asks. Every host decision has to happen here.
 *
 * ## Why it fails closed, and what that means for the one case that looks harmless
 *
 * `new URL(value)` without a base throws on anything that is not absolute, and the catch
 * drops the node rather than letting it through. That is deliberate and it is the single
 * most important line in the file, because of this input:
 *
 * ```
 *   <img src="//evil.com/x.png">
 * ```
 *
 * A protocol-relative URL. It has no scheme, so a scheme allowlist has nothing to reject; it
 * is not relative to our origin either, so "it is a relative path, it must be ours" is
 * false. The browser resolves it against the page's protocol and fetches it from evil.com,
 * which leaks every reader's IP and User-Agent to a third party and hands them a per-reader
 * tracking pixel on a page that promises no third-party anything.
 *
 * The cost of failing closed is that a genuinely relative `src="/img/x.png"` is dropped too.
 * That is correct here: images are uploaded through the admin editor and come back as
 * absolute Cloudinary URLs, so a relative path in a post body is a typo, and a dropped image
 * is a visible bug the author fixes in a minute. Letting it through to avoid that would mean
 * admitting the protocol-relative case, which is invisible and permanent.
 *
 * ## Why every clause is here
 *
 * Each one is a real bypass of the naive version of this check, not a hypothetical:
 *
 * `hostname`, never `startsWith` or `includes`. `res.cloudinary.com.evil.com` starts with a
 * host we trust and is an entirely different host. `hostname` is the parsed authority, so it
 * is the whole thing or nothing. It is also already lowercased and has its trailing dot
 * normalised by `URL`, which is why `RES.CLOUDINARY.COM` and `res.cloudinary.com.` need no
 * special handling.
 *
 * `username`/`password` empty. `https://res.cloudinary.com@evil.com/x.png` parses with
 * `hostname === 'evil.com'` and `username === 'res.cloudinary.com'`. Modern `URL` gets this
 * right, so the hostname check alone already rejects it - but these two lines cost nothing
 * and they state the intent for the next reader, who would otherwise have to know that fact
 * about `URL` to see why the line is safe.
 *
 * `pathname.startsWith('/<cloud>/')`. This is the clause people leave out, and it is the one
 * that makes the check mean anything: **`res.cloudinary.com` is multi-tenant.** Anyone can
 * open a free Cloudinary account, and their assets are served from the same hostname under a
 * different cloud name. Without this, "must be Cloudinary" means "must be somebody's
 * Cloudinary", and an author (or anyone who gets markdown into a draft) can serve arbitrary
 * images - including a tracking pixel - from the one host the pipeline trusts.
 *
 * ## `srcset` and `longdesc`, not just `src`
 *
 * `<source srcset>` inside `<picture>` and `<img srcset>` are image URLs the browser fetches
 * exactly like `src`, and `longdesc` is a URL the browser may follow. A check that guards
 * `img[src]` alone is a check with three doors open next to it. `srcset` is a comma-separated
 * list with optional descriptors, so it is parsed, filtered candidate by candidate, and
 * reassembled - a single bad candidate drops that candidate, not the whole attribute.
 */

const ALLOWED_HOST = 'res.cloudinary.com'

/**
 * Read at module load. When it is unset - a local checkout with no Cloudinary env - the
 * predicate rejects everything rather than falling back to "any cloud name", because the
 * fallback would be a development convenience that disables the control in production the
 * first time the variable goes missing there.
 */
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? ''

export function isAllowedImageUrl(value: string): boolean {
  if (!CLOUD_NAME) return false

  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Not absolute. `//evil.com/x.png` is the case that matters - see the header.
    return false
  }

  return (
    url.protocol === 'https:' &&
    url.hostname === ALLOWED_HOST &&
    url.username === '' &&
    url.password === '' &&
    url.pathname.startsWith(`/${CLOUD_NAME}/`)
  )
}

/**
 * Filter a `srcset` value down to its allowed candidates.
 *
 * Returns `null` when nothing survives, which the caller turns into "remove the attribute" -
 * an empty `srcset=""` is not the same as an absent one and some browsers treat it as a
 * candidate list of one empty URL.
 */
export function filterSrcset(value: string): string | null {
  const kept = value
    .split(',')
    .map(candidate => candidate.trim())
    .filter(candidate => candidate.length > 0)
    .filter(candidate => {
      // `url 2x` / `url 640w` / bare `url`. The URL is the first whitespace-delimited token;
      // descriptors never contain whitespace themselves.
      const [urlPart] = candidate.split(/\s+/)
      return urlPart !== undefined && isAllowedImageUrl(urlPart)
    })

  return kept.length > 0 ? kept.join(', ') : null
}

/** The attributes checked per tag. Anything not listed here is not a URL we hand a browser. */
const URL_ATTRIBUTES: Record<string, string[]> = {
  img: ['src', 'longdesc', 'srcset'],
  source: ['src', 'srcset'],
}

export default function rehypeRestrictImageHosts() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      const attributes = URL_ATTRIBUTES[node.tagName]
      if (!attributes) return

      for (const name of attributes) {
        const value = node.properties?.[name]
        if (typeof value !== 'string') continue

        if (name === 'srcset') {
          const filtered = filterSrcset(value)
          if (filtered === null) delete node.properties[name]
          else node.properties[name] = filtered

          continue
        }

        if (!isAllowedImageUrl(value)) delete node.properties[name]
      }
    })
  }
}
