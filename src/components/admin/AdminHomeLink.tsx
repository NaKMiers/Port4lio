'use client'

import { BookOpen, LayoutGrid } from 'lucide-react'
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
 * Nothing on `/admin/ccaf/vocab` either, for a different reason: that board is a framed app
 * sized to the viewport with equal margins on all four sides, and a pill floating above the
 * frame both eats the height it wants and breaks the symmetry. It carries the same link as
 * an icon inside its own rail instead, so hiding this one costs no navigation.
 *
 * The CCA-F roadmap gets a second pill straight to that vocab deck: it is a sibling board
 * one click away, and going by way of the hub for something used mid-study session is
 * friction the roadmap page can spare. Everywhere else stays a single pill.
 */
export default function AdminHomeLink() {
  const pathname = usePathname()
  if (pathname === '/admin' || pathname === '/admin/ccaf/vocab') return null

  const isCcafRoadmap =
    pathname === '/admin/ccaf' || pathname === '/admin/ccaf/en'

  return (
    <div className="relative mx-auto flex w-full max-w-editorial items-center justify-between gap-3 px-gutter pt-8">
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
      {isCcafRoadmap ? (
        <Link
          href="/admin/ccaf/vocab"
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
