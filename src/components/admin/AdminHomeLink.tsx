'use client'

import { LayoutGrid } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
 */
export default function AdminHomeLink() {
  const pathname = usePathname()
  if (pathname === '/admin') return null

  return (
    <div className='relative mx-auto w-full max-w-editorial px-gutter pt-8'>
      <Link
        href='/admin'
        className='inline-flex min-h-[36px] items-center gap-2 rounded-full border border-pp-line bg-white/78 px-4 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted no-underline shadow-[0_10px_24px_rgba(46,35,28,0.06)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white hover:text-pp-text'
      >
        <LayoutGrid aria-hidden size={13} />
        All boards
      </Link>
    </div>
  )
}
