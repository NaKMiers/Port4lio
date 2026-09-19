import { BarChart3, FileText, GraduationCap, Send, SlidersHorizontal } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import OwnerAuthGate from '@/components/settings/OwnerAuthGate'

export const metadata: Metadata = {
  title: 'Admin',
}

/**
 * `/admin` - the hub, and the only page in the group that is not a board.
 *
 * ```
 *   /admin
 *     ├── Portfolio    /admin/settings   the one-page editor + preview rail
 *     ├── Blog         /admin/blog       drafts, publish, the quiet-days signal
 *     ├── Publish      /admin/publish    the syndication artifacts
 *     ├── Metrics      /admin/metrics    MBTI + IQ attempt counts
 *     └── CCA-F        /admin/ccaf       the certification tracker (vi | en)
 * ```
 *
 * ## Why this exists at all
 *
 * `/admin` was a 404. The five boards were reachable only by typing their URLs, which was
 * survivable while `SiteChrome` rendered a nav bar and stopped being survivable the moment
 * that nav came out - and it had to come out, because its six links pointed at the public
 * one-page site rather than at anything here. So the nav did not disappear; it moved, and
 * this is where it went. `AdminHomeLink` puts a single link back to this page on every
 * board, which is the whole navigation graph: hub to board, board to hub.
 *
 * ## Why it is gated
 *
 * Every destination runs its own `OwnerAuthGate` (or `CcafGate`), so this one gate is not
 * what protects the data - the boards are safe without it. It is here for two smaller
 * reasons: one code entry at the hub leaves the cookie set for every board behind it, and an
 * ungated hub is a published index of which owner surfaces exist. `robots.ts` disallows
 * `/admin`, but a `Disallow` is a request and this is not.
 *
 * ## No live counts on the cards
 *
 * The obvious next idea is a badge per card - 3 drafts, 14 days quiet, 812 attempts - and
 * each one is a query this page would have to run before it can render a list of links. The
 * layout is already `force-dynamic`, so there is no cache to amortise them against, and the
 * hub would become the slowest page in the group in exchange for numbers that are on the
 * board one click away. The quiet-days signal in particular already lives on `BlogBoard`,
 * where it is next to the thing it is telling you to do.
 */

type Board = {
  href: string
  title: string
  blurb: string
  Icon: typeof SlidersHorizontal
  /** Tailwind classes for the icon chip. Kept per-card so the grid is scannable by colour. */
  tint: string
  secondary?: { href: string; label: string }[]
}

const BOARDS: readonly Board[] = [
  {
    href: '/admin/settings',
    title: 'Portfolio',
    blurb: 'The one-page editor. Basics, about, services, projects, skills and the CV sheet, with the live preview rail.',
    Icon: SlidersHorizontal,
    tint: 'border-pp-orange/30 bg-pp-orange/10 text-pp-orange',
  },
  {
    href: '/admin/blog',
    title: 'Blog',
    blurb: 'Drafts, publishing and the days-since-last-post signal. Start a draft from a source comment you already wrote.',
    Icon: FileText,
    tint: 'border-pp-blue/30 bg-pp-blue/10 text-pp-blue',
  },
  {
    href: '/admin/publish',
    title: 'Publish',
    blurb: 'The syndication artifacts: the GitHub README, the LinkedIn about, the Upwork profile, and what is paste-only.',
    Icon: Send,
    tint: 'border-pp-green/30 bg-pp-green/10 text-pp-green',
  },
  {
    href: '/admin/metrics',
    title: 'Metrics',
    blurb: 'MBTI and IQ attempts, completion, and where people stop. The traffic the availability block is aimed at.',
    Icon: BarChart3,
    tint: 'border-pp-violet/30 bg-pp-violet/10 text-pp-violet',
  },
  {
    href: '/admin/ccaf',
    title: 'CCA-F',
    blurb: 'The certification tracker: roadmap, readiness and the reference deck.',
    Icon: GraduationCap,
    tint: 'border-pp-pink/30 bg-pp-pink/10 text-pp-pink',
    secondary: [
      { href: '/admin/ccaf/en', label: 'English' },
      { href: '/admin/ccaf/vocab', label: 'Vocab' },
    ],
  },
]

export default function AdminHubPage() {
  return (
    <OwnerAuthGate>
      <div className='mx-auto w-full max-w-editorial px-gutter py-10'>
        <header>
          <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
            Owner
          </p>
          <h1 className='mt-2 font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl'>
            Control room
          </h1>
          <p className='mt-3 max-w-[60ch] text-lg leading-relaxed text-pp-muted'>
            Everything on this site that only you can change. Nothing here is indexed, and
            every board re-checks the cookie on its own.
          </p>
        </header>

        <div className='mt-10 grid gap-5 sm:grid-cols-2'>
          {BOARDS.map(({ href, title, blurb, Icon, tint, secondary }) => (
            <div key={href} className='relative'>
              {/*
                The whole card is the link, so the target is the card and not the six
                characters of its title. `secondary` sits outside it and above it - a link
                inside a link is invalid HTML and the browser drops the inner one.
              */}
              <Link
                href={href}
                className='group flex h-full flex-col rounded-panel border border-pp-line bg-pp-panel p-6 no-underline shadow-panel backdrop-blur-md transition-transform motion-safe:hover:-translate-y-1'
              >
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border ${tint}`}
                  aria-hidden
                >
                  <Icon size={19} />
                </span>
                <h2 className='mt-4 font-display text-xl font-semibold text-pp-text'>
                  {title}
                </h2>
                <p className='mt-2 text-sm leading-relaxed text-pp-muted'>{blurb}</p>
              </Link>

              {secondary ? (
                <div className='absolute right-6 top-6 flex flex-col items-end gap-1.5'>
                  {secondary.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className='rounded-full border border-pp-line bg-white/82 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-pp-muted no-underline backdrop-blur-md transition-colors hover:text-pp-text'
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <p className='mt-10 text-sm text-pp-muted'>
          Back to the{' '}
          <Link href='/' className='text-pp-text'>
            public site
          </Link>
          .
        </p>
      </div>
    </OwnerAuthGate>
  )
}
