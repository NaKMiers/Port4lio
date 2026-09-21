import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import type { Locale } from '@/lib/i18n'

/**
 * Who made this, and that he is open to work.
 *
 * ```
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  BUILT BY                                        ← eyebrow     │
 *   │  Anh Khoa Nguyen · Full stack developer                        │
 *   │  <one line on what he is open to>                              │
 *   │  [ Get in touch ]  [ See the portfolio ]  [ Write-ups ]        │
 *   └────────────────────────────────────────────────────────────────┘
 *                  ↓                  ↓                  ↓
 *              /#contact              /                /blog
 * ```
 *
 * ## Why this exists
 *
 * It is the entire premise of the blog feature, and the one part of it that does not need
 * the blog. The MBTI and IQ tests already receive traffic; none of it has ever been offered
 * a path to the person who built them. A surface with an audience and no conversion path is
 * a hobby, so this ships first and alone, and four weeks of it against existing traffic
 * answers a question the blog would otherwise conflate: is conversion the constraint, or is
 * the audience wrong? Zero contacts in four weeks means the second, and five blog posts
 * aimed at the same audience will not fix it.
 *
 * ## Why it takes a locale and the blog will not
 *
 * `(choice)` is bilingual and the blog is English-only (D7 - Viblo is the native home of
 * the Vietnamese version, written as a Vietnamese post rather than a translation). So this
 * component serves two audiences that do not overlap: a Vietnamese teenager who just took a
 * personality test, and an English-reading recruiter on a post about a Next.js cache bug.
 *
 * The copy differs by more than language because of that. The Vietnamese version does not
 * say "open to opportunities" - it says what he does and offers a way to reach him, because
 * a hire-me pitch aimed at a test-taker who is not hiring anyone reads as an advert. The
 * English version is allowed to be direct.
 *
 * ## Why it is not rendered by default
 *
 * See `TestChrome`'s `footerSlot` prop. The short version: interrupting a questionnaire
 * with a hire-me pitch is the specific failure this placement exists to prevent, and a
 * default would put it there.
 */

const COPY: Record<
  Locale,
  {
    eyebrow: string
    role: string
    open: string
    contact: string
    portfolio: string
    writing: string
  }
> = {
  vi: {
    eyebrow: 'Người làm trang này',
    role: 'Anh Khoa Nguyen · Lập trình viên full stack',
    open: 'Mình tự viết cả hai bài test trên trang này. Nếu bạn muốn trao đổi về một dự án, hoặc chỉ tò mò nó được làm thế nào, cứ nhắn cho mình.',
    contact: 'Liên hệ',
    portfolio: 'Xem portfolio',
    // Labelled as English, not silently linked. The blog is English-only (D7) and most of
    // this locale's traffic is Vietnamese, so an unmarked link would send a reader to a page
    // they cannot read and teach them that links here waste their time.
    writing: 'Bài viết kỹ thuật (tiếng Anh)',
  },
  en: {
    eyebrow: 'Built by',
    role: 'Anh Khoa Nguyen · Full stack developer',
    open: 'I built both of the tests on this site. I am open to full stack work - contract or full time - and happy to talk about how any of this was put together.',
    contact: 'Get in touch',
    portfolio: 'See the portfolio',
    writing: 'Read the write-ups',
  },
}

export default function AvailabilityBlock({ locale }: { locale: Locale }) {
  const copy = COPY[locale]

  return (
    /*
      `<aside>`, not `<section>`. This is complementary to whatever page it sits under - a
      result, a type description, a landing page - and never that page's subject. A screen
      reader announcing it as a section of the MBTI result would be describing the wrong
      relationship, and `aria-labelledby` gives the landmark a name either way.
    */
    <aside
      aria-labelledby="availability-heading"
      className="border-t border-pp-line bg-[var(--pp-panel)]"
    >
      <div className="mx-auto w-full max-w-editorial px-gutter py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
          {copy.eyebrow}
        </p>
        <h2
          id="availability-heading"
          className="mt-2 font-display text-lg font-semibold text-pp-text"
        >
          {copy.role}
        </h2>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-pp-muted">
          {copy.open}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {/*
            `/#contact` and not `/`: the contact form is the last section of a long
            single-page portfolio, so landing at the top means scrolling past everything to
            reach the thing this button promised. The anchor is `ContactSection`'s own
            `id`, which `FloatingSectionNav` already depends on.

            Both links leave `(choice)` for `(me)`, which is English-only by design - hence
            no locale prefix on either, and hence the Vietnamese copy sending people to
            "portfolio" rather than promising a Vietnamese page that does not exist.
          */}
          <Link
            href="/#contact"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-pp-text px-6 py-2.5 font-display text-sm font-semibold text-[var(--pp-bg)] no-underline shadow-panel transition-transform motion-safe:hover:-translate-y-0.5"
          >
            {copy.contact}
            <ArrowRight
              aria-hidden
              size={15}
            />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-full border border-pp-line px-6 py-2.5 font-display text-sm font-semibold text-pp-text no-underline transition-colors hover:border-pp-blue/40"
          >
            {copy.portfolio}
          </Link>
          {/*
            Into the blog. The MBTI and IQ pages are the only channel on this site already
            carrying volume, so without this link the blog's only inbound traffic is whatever
            a cross-post sends - and a blog nobody reaches goes quiet, which is the modal
            failure across the 27 sites reviewed for this feature.
          */}
          <Link
            href="/blog"
            className="inline-flex min-h-[44px] items-center rounded-full border border-pp-line px-6 py-2.5 font-display text-sm font-semibold text-pp-text no-underline transition-colors hover:border-pp-blue/40"
          >
            {copy.writing}
          </Link>
        </div>
      </div>
    </aside>
  )
}
