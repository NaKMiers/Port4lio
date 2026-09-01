import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * Site-wide 404.
 *
 * Bilingual on purpose rather than picking one language. This file renders inside the root
 * layout, above both route groups, so it has no locale to read: a request for a bad
 * `/vi/mbti/...` path and a request for a bad portfolio path both land here. Guessing
 * wrong would leave half of the visitors on a page they cannot read, and the copy is two
 * short lines.
 *
 * Styled with `portfolio-public-root` so the tokens resolve - the same wrapper `(me)` and
 * `(choice)` rely on. Without it the `pp-*` utilities below would render as nothing, since
 * they are backed by CSS variables declared on that class.
 */

export const metadata: Metadata = {
  title: '404',
  // A 404 response is not indexed regardless, but this makes the intent explicit for
  // crawlers that fetch the body before reading the status line.
  robots: { index: false, follow: true },
}

const DESTINATIONS = [
  { href: '/', vi: 'Trang chủ', en: 'Home' },
  { href: '/vi/mbti', vi: 'Trắc nghiệm MBTI', en: 'MBTI test' },
  { href: '/cv', vi: 'CV', en: 'CV' },
] as const

export default function NotFound() {
  return (
    <div className='portfolio-public-root flex min-h-screen items-center justify-center px-gutter py-24'>
      <div className='w-full max-w-xl text-center'>
        <p className='font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-pp-muted'>
          404
        </p>

        <h1 className='mt-4 font-display text-[clamp(1.875rem,5vw,2.75rem)] font-semibold leading-tight tracking-tight text-pp-text'>
          Không tìm thấy trang này
        </h1>
        <p className='mt-2 font-display text-lg font-medium text-pp-muted'>Page not found</p>

        <p className='mt-6 text-sm leading-relaxed text-pp-muted'>
          Đường dẫn có thể đã sai, hoặc kết quả bạn tìm đã hết hạn.
          <br />
          The link may be wrong, or a result you are looking for has expired.
        </p>

        {/*
          Real links out, not just an apology. A 404 with no route back is a dead end for a
          visitor and a dead end for a crawler that followed a stale link here.
        */}
        <ul className='mt-9 flex flex-wrap items-center justify-center gap-3'>
          {DESTINATIONS.map(destination => (
            <li key={destination.href}>
              <Link
                href={destination.href}
                className='inline-flex items-center rounded-full border border-pp-line bg-white/70 px-5 py-2.5 font-display text-xs font-semibold uppercase tracking-[0.16em] text-pp-text no-underline shadow-[0_8px_18px_rgba(46,35,28,0.05)] backdrop-blur-md transition hover:-translate-y-0.5 motion-reduce:hover:translate-y-0'
              >
                {destination.vi === destination.en
                  ? destination.vi
                  : `${destination.vi} / ${destination.en}`}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
