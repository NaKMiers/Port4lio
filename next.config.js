/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /** Chunk 0 / Chunk 10: real HTTP 308s for legacy permalinks (App Router `permanentRedirect` alone may not emit redirect responses). */
  async redirects() {
    return [
      { source: '/about', destination: '/?section=about', permanent: true },
      { source: '/services', destination: '/?section=services', permanent: true },
      { source: '/work', destination: '/?section=work', permanent: true },
      { source: '/contact', destination: '/?section=contact', permanent: true },
      { source: '/testimonials', destination: '/?section=testimonials', permanent: true },
    ]
  },

  /**
   * Content-Security-Policy, on the blog only.
   *
   * ## `script-src` carries 'unsafe-inline', deliberately, and that is not laziness
   *
   * Next emits its own bootstrap inline and UNNONCED:
   *
   *     <script>(self.__next_f=self.__next_f||[]).push([0])</script>
   *
   * A plain `script-src 'self'` rejects it. The page then renders correctly, looks perfect
   * in any server-side test, and never hydrates - every interactive element is dead in a
   * real browser and nothing on the server side notices. That failure was reproduced before
   * this header was written.
   *
   * A nonce would be the right answer and cannot be set from here. Next mints one only by
   * parsing a CSP off the INCOMING REQUEST, which requires middleware - and `src/proxy.ts`'s
   * body is an unconditional redirect whose matcher deliberately excludes `/blog`. Routing
   * every blog request through it to obtain a nonce is a much larger change than this header.
   *
   * So the honest statement is: **this CSP is not a script-XSS control.** Script-XSS is
   * handled upstream, by the markdown pipeline, which drops raw HTML at remark-rehype and
   * runs `rehype-sanitize` over everything else before any of it is stored.
   *
   * What the header IS worth is the four directives that do not fall back to `default-src`
   * and therefore have to be named or they are simply absent:
   *
   *   frame-ancestors 'none'   nobody can iframe a post to clickjack the availability CTA
   *   base-uri 'self'          an injected <base> cannot re-root every relative URL
   *   form-action 'self'       a form cannot be made to POST somewhere else
   *   img-src                  pinned to self + our Cloudinary, matching the pipeline
   *
   * `img-src` deliberately omits `data:`. A data URL carries its bytes inline, so it bypasses
   * the image-host visitor's entire reasoning - there is no host to check.
   *
   * ## Both `source` entries are required
   *
   * `/blog/:path*` does NOT match `/blog` itself. Listing only the wildcard leaves the index
   * page - the one linked from `/`, `/cv` and both test products - with no CSP at all, which
   * is the kind of gap that looks fine in every spot check of a post page.
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://res.cloudinary.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')

    return [
      {
        source: '/blog',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
      {
        source: '/blog/:path*',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
    ]
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        pathname: '**',
      },
    ],
  },
}

module.exports = nextConfig
