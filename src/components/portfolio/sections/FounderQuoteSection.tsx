import { Quote } from 'lucide-react'

import { MetricTile } from '@/components/portfolio/primitives/MetricTile'
import { ProofCard } from '@/components/portfolio/primitives/ProofCard'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import type { FounderProofViewModel } from '@/lib/profile-view-model'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type FounderQuoteSectionProps = {
  founderProof: FounderProofViewModel
}

/**
 * Founder-authored perspective + compact proof stats - not client testimonials.
 */
export default function FounderQuoteSection({
  founderProof,
}: FounderQuoteSectionProps) {
  const { quote, attributionName, highlightStats } = founderProof
  if (!quote && highlightStats.length === 0) return null

  return (
    <SectionFrame
      aria-labelledby="founder-proof-heading"
      className="border-b border-pp-line bg-gradient-to-b from-pp-panel/30 to-transparent pb-section-sm pt-0 md:scroll-mt-28"
    >
      <div className="space-y-8 md:space-y-10">
        <h2
          id="founder-proof-heading"
          className="sr-only"
        >
          Founder perspective
        </h2>

        {quote ? (
          <ProofCard
            kicker="Perspective"
            media={
              <Quote
                className="h-6 w-6 text-pp-blue"
                strokeWidth={1.75}
                aria-hidden
              />
            }
            footer={
              <p className="font-display text-sm font-semibold text-pp-text">
                <span
                  className="text-pp-muted"
                  aria-hidden
                >
                  -
                </span>{' '}
                {attributionName}
              </p>
            }
            className="md:gap-8"
          >
            <blockquote className="m-0 border-none p-0">
              <p className="m-0 text-pretty font-display text-[clamp(1.05rem,2.2vw,1.35rem)] font-medium leading-relaxed text-pp-text">
                {quote}
              </p>
            </blockquote>
          </ProofCard>
        ) : null}

        {highlightStats.length > 0 ? (
          <div>
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
              At a glance
            </p>
            <ul
              className={cx(
                'grid gap-3 sm:grid-cols-2 sm:gap-4',
                highlightStats.length >= 3 ? 'lg:grid-cols-3' : ''
              )}
            >
              {highlightStats.map(s => (
                <li key={s.label}>
                  <MetricTile
                    label={s.label}
                    value={String(s.value)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionFrame>
  )
}
