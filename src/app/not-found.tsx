import type { Metadata } from 'next'

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
 *
 * Deliberately has no links out. The header on every other page already carries navigation,
 * and a row of buttons here read as clutter on what should be a short, quiet message.
 */

export const metadata: Metadata = {
  title: '404',
  // A 404 response is not indexed regardless, but this makes the intent explicit for
  // crawlers that fetch the body before reading the status line.
  robots: { index: false, follow: true },
}

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
      </div>
    </div>
  )
}
