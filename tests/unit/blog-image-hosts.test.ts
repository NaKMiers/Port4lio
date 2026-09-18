import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The image-host predicate, attacked rather than demonstrated.
 *
 * This is the only genuinely dangerous surface in the blog pipeline. Everything else either
 * drops author input (raw HTML) or constrains it to an enumerated allowlist (the sanitize
 * schema); image URLs are the one place a full author-controlled string is handed to a
 * browser as something to fetch. So the cases below are bypasses, not examples, and each one
 * names what it would cost if it passed.
 *
 * `CLOUDINARY_CLOUD_NAME` is set before the import because the module reads it at load and
 * rejects everything when it is empty - which is correct behaviour, asserted at the bottom,
 * but would make every other case here pass for the wrong reason.
 */

const CLOUD = 'demo-cloud'

let isAllowedImageUrl: (value: string) => boolean
let filterSrcset: (value: string) => string | null

beforeAll(async () => {
  process.env.CLOUDINARY_CLOUD_NAME = CLOUD
  const mod = await import('@/lib/blog/rehype-restrict-image-hosts')
  isAllowedImageUrl = mod.isAllowedImageUrl
  filterSrcset = mod.filterSrcset
})

const OK = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/post/cover.png`

describe('isAllowedImageUrl - what it must accept', () => {
  it('accepts our own Cloudinary asset', () => {
    expect(isAllowedImageUrl(OK)).toBe(true)
  })

  it('accepts query strings and Cloudinary transformation segments', () => {
    // Transformations are how every real cover image is served, so a predicate that only
    // accepted bare paths would be rejected by the first post that used one.
    expect(
      isAllowedImageUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/w_800,q_auto/v1/a.png`)
    ).toBe(true)
    expect(isAllowedImageUrl(`${OK}?v=2`)).toBe(true)
  })
})

describe('isAllowedImageUrl - the bypasses', () => {
  it('DROPS a protocol-relative URL, which has no scheme to reject', () => {
    // The reason the `new URL()` catch fails closed. The browser resolves this against the
    // page protocol and fetches it from evil.com, leaking every reader's IP and User-Agent
    // and handing a third party a per-reader tracking pixel.
    expect(isAllowedImageUrl('//evil.com/x.png')).toBe(false)
  })

  it('DROPS userinfo that makes the trusted host look like the authority', () => {
    // hostname here is evil.com; 'res.cloudinary.com' is the username.
    expect(isAllowedImageUrl('https://res.cloudinary.com@evil.com/x.png')).toBe(false)
    expect(isAllowedImageUrl(`https://res.cloudinary.com:pw@evil.com/${CLOUD}/x.png`)).toBe(false)
  })

  it('DROPS a host that merely starts with the trusted one', () => {
    // Why the check is `hostname ===` and never `startsWith`/`includes`.
    expect(isAllowedImageUrl(`https://res.cloudinary.com.evil.com/${CLOUD}/x.png`)).toBe(false)
    expect(isAllowedImageUrl(`https://notres.cloudinary.com/${CLOUD}/x.png`)).toBe(false)
  })

  it('DROPS plain http, even on the right host', () => {
    expect(isAllowedImageUrl(`http://res.cloudinary.com/${CLOUD}/image/upload/x.png`)).toBe(false)
  })

  it("DROPS someone else's cloud name on the right host", () => {
    // THE clause people leave out. res.cloudinary.com is multi-tenant - anyone can open a
    // free account and serve from this exact hostname. Without the path check, "must be
    // Cloudinary" means "must be somebody's Cloudinary".
    expect(isAllowedImageUrl('https://res.cloudinary.com/attacker/image/upload/x.png')).toBe(false)
    // And a path that merely CONTAINS our cloud name further down.
    expect(isAllowedImageUrl(`https://res.cloudinary.com/attacker/${CLOUD}/x.png`)).toBe(false)
    // And a prefix match on the cloud segment itself, which is why the check ends in '/'.
    expect(isAllowedImageUrl(`https://res.cloudinary.com/${CLOUD}-evil/x.png`)).toBe(false)
  })

  it('DROPS data: and javascript: URLs outright', () => {
    expect(isAllowedImageUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false)
    expect(isAllowedImageUrl('javascript:alert(1)')).toBe(false)
  })

  it('DROPS relative paths, and that is the accepted cost of failing closed', () => {
    // Images arrive from the editor as absolute Cloudinary URLs, so this is a typo, and a
    // missing image is visible in seconds. Admitting it would mean admitting the
    // protocol-relative case above, which is invisible and permanent.
    expect(isAllowedImageUrl('/img/local.png')).toBe(false)
    expect(isAllowedImageUrl('cover.png')).toBe(false)
  })
})

describe('isAllowedImageUrl - which normalisations URL does and does not do', () => {
  it('accepts an uppercase host, because URL lowercases it', () => {
    // Asserted rather than assumed. If this stopped being true the `hostname ===` check
    // would start rejecting valid images, and the obvious "fix" is a case-insensitive
    // `includes` - which is precisely the bypass asserted two describes up.
    expect(isAllowedImageUrl(`https://RES.CLOUDINARY.COM/${CLOUD}/image/upload/x.png`)).toBe(true)
  })

  it('DROPS a trailing dot, because URL does NOT strip it', () => {
    // Measured, and worth pinning because the intuition goes the other way: `URL` lowercases
    // the host but leaves the root-label dot alone, so `hostname` is 'res.cloudinary.com.'
    // and the equality check rejects it. `https://res.cloudinary.com./x` is a real request
    // a browser will make and it resolves to the same server, so this is a false negative,
    // not a hole - a cover image written that way silently disappears.
    //
    // Left failing closed on purpose: the alternative is normalising the host ourselves,
    // and hand-rolled host normalisation next to a multi-tenant allowlist is how the
    // `startsWith` bypass gets reintroduced by someone being helpful.
    expect(isAllowedImageUrl(`https://res.cloudinary.com./${CLOUD}/image/upload/x.png`)).toBe(false)
  })
})

describe('filterSrcset', () => {
  it('keeps only the allowed candidates and preserves their descriptors', () => {
    const value = `${OK} 1x, https://evil.com/x.png 2x`
    expect(filterSrcset(value)).toBe(`${OK} 1x`)
  })

  it('returns null when nothing survives, so the caller removes the attribute', () => {
    // An empty srcset="" is not the same as an absent one - some browsers read it as a
    // candidate list containing one empty URL.
    expect(filterSrcset('https://evil.com/a.png 1x, //evil.com/b.png 2x')).toBeNull()
  })

  it('handles bare URLs with no descriptor', () => {
    expect(filterSrcset(OK)).toBe(OK)
  })
})

describe('the empty-cloud-name case', () => {
  it('rejects everything when CLOUDINARY_CLOUD_NAME is unset', async () => {
    // A local checkout with no Cloudinary env must not fall back to "any cloud name". That
    // fallback would be a dev convenience that silently disables the control the first time
    // the variable goes missing in production.
    process.env.CLOUDINARY_CLOUD_NAME = ''
    // resetModules, not a query-string import: the module reads the env var once at load,
    // so it has to be evaluated again rather than re-resolved.
    vi.resetModules()
    const fresh = await import('@/lib/blog/rehype-restrict-image-hosts')

    expect(fresh.isAllowedImageUrl(OK)).toBe(false)

    process.env.CLOUDINARY_CLOUD_NAME = CLOUD
    vi.resetModules()
  })
})
