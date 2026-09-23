'use client'

import { Award, BookOpen, LayoutGrid } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const pillCls =
  'inline-flex min-h-[36px] items-center gap-2 rounded-full border border-pp-line bg-white/78 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted no-underline shadow-[0_10px_24px_rgba(46,35,28,0.06)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white hover:text-pp-text'

/**
 * The only navigation the owner surfaces have.
 *
 * `SiteChrome` used to render `Nav` and `Header` here, which was wrong twice over: the nav
 * linked to the six PUBLIC one-page sections (`/?section=about`, `/?section=work`, ...), so
 * every link led off the admin area entirely, and the header rendered the public logo and
 * the social icons above a profile editor. Removing them left the boards with no way to
 * reach each other, so this replaces both with the one link that is actually useful.
 *
 * Renders nothing on `/admin` itself - a "back to the hub" pill on the hub is a link to the
 * page you are reading.
 *
 * Nothing on `/admin/certificates/ccaf/vocab` or `/admin/whiteboard` either, for a different
 * reason: those boards are framed apps sized to the viewport with equal margins on all four
 * sides, and a pill floating above the frame both eats the height they want and breaks the
 * symmetry - the whiteboard's own canvas would also sit under the ~68px pill row. Each
 * carries its own way back instead: the vocab rail's hub and roadmap icons, the whiteboard
 * top bar's grid icon (DR2).
 *
 * Pages under `/admin/certificates/` add a Certificates pill beside the hub one, so the
 * overview is one click back. The CCA-F roadmap also gets a pill on the right straight to
 * the vocab deck: a sibling board used mid-study session, where going by way of the hub is
 * friction the page can spare.
 */
export default function AdminHomeLink() {
  const pathname = usePathname()
  if (
    pathname === '/admin' ||
    pathname === '/admin/certificates/ccaf/vocab' ||
    pathname === '/admin/whiteboard'
  )
    return null

  const isCcafRoadmap = pathname === '/admin/certificates/ccaf'
  // Pages below the certificates overview get a way back up to it, not just to the hub.
  const underCertificates = pathname.startsWith('/admin/certificates/')

  return (
    <div className="relative mx-auto flex w-full max-w-editorial items-center justify-between gap-3 px-gutter pt-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin"
          className={pillCls}
        >
          <LayoutGrid
            aria-hidden
            size={13}
          />
          All boards
        </Link>
        {underCertificates ? (
          <Link
            href="/admin/certificates"
            className={pillCls}
          >
            <Award
              aria-hidden
              size={13}
            />
            Certificates
          </Link>
        ) : null}
      </div>
      {isCcafRoadmap ? (
        <Link
          href="/admin/certificates/ccaf/vocab"
          className={pillCls}
        >
          <BookOpen
            aria-hidden
            size={13}
          />
          Vocab
        </Link>
      ) : null}
    </div>
  )
}
