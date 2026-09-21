import Link from 'next/link'

import Chevron from '@/components/mbti/Chevron'

/**
 * The pull toward the scoring-method page.
 *
 * ```
 *   ┌──────────────────────────────────────────────┐
 *   │  ?  Is this score real?                      │
 *   │     Most sites skew scores upward. We don't. │
 *   │     See how scoring works  →                 │
 *   └──────────────────────────────────────────────┘
 * ```
 *
 * A plain "How scoring works" link is a footnote, and footnotes do not get clicked. This
 * leads with the question the visitor already has - is this number real - and answers it
 * with the one thing competitors cannot say. Curiosity plus a specific claim, rather than
 * a label.
 *
 * It is also the honest pitch rather than a growth trick: the page behind it genuinely does
 * publish the whole band table and state what the test cannot do. If that page ever softens,
 * this card becomes a lie and both should change together.
 */
export default function MethodTease({
  href,
  title,
  body,
  cta,
  className,
}: {
  href: string
  title: string
  body: string
  cta: string
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`group block rounded-2xl border border-pp-line bg-pp-panel p-6 no-underline transition hover:-translate-y-0.5 hover:border-pp-blue/60 hover:shadow-[0_18px_36px_rgba(31,28,26,0.10)] motion-reduce:hover:translate-y-0 md:p-7 ${className ?? ''}`}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full bg-[linear-gradient(135deg,var(--pp-violet),var(--pp-blue))] font-display text-lg font-semibold text-white"
        >
          ?
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-snug text-pp-text md:text-xl">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-pp-muted md:text-base">
            {body}
          </p>
          <span className="mt-4 inline-flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.16em] text-pp-text">
            {cta}
            <span className="transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none">
              <Chevron direction="right" />
            </span>
          </span>
        </div>
      </div>
    </Link>
  )
}
