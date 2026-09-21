import { ProofCard, SectionFrame } from '@/components/portfolio/primitives'
import type { TrustViewModel } from '@/lib/profile-view-model'

type TrustSectionProps = {
  trust: TrustViewModel
}

/**
 * Proof layer: stats, experience, store links, and capability signals derived in
 * {@link derivePublicPortfolioViewModel} - no testimonials or synthetic quotes.
 */
export default function TrustSection({ trust }: TrustSectionProps) {
  if (!trust.cards.length) return null

  const trustKickers = Array.from(
    new Set(trust.cards.map(card => card.kicker).filter(Boolean))
  )
  const subheading = trustKickers.length
    ? `${trustKickers.join(', ')}. This section is assembled from the same live portfolio data, not filler testimonials.`
    : 'Live signals from the portfolio data: impact, shipped work, capabilities, and experience.'

  return (
    <SectionFrame
      id="testimonials"
      aria-labelledby="trust-heading"
      className="scroll-mt-24 border-b border-pp-line md:scroll-mt-28"
    >
      <div className="mb-8 max-w-2xl space-y-3">
        <h2
          id="trust-heading"
          className="font-display text-[clamp(1.75rem,3.5vw,2.25rem)] font-semibold tracking-tight text-pp-text"
        >
          Proof that already exists
        </h2>
        <p className="font-display text-base font-medium leading-relaxed text-pp-muted md:text-lg">
          {subheading}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {trust.cards.map(card => (
          <ProofCard
            key={card.id}
            kicker={card.kicker}
            title={card.title}
          >
            <span className="whitespace-pre-line">{card.body}</span>
          </ProofCard>
        ))}
      </div>
    </SectionFrame>
  )
}
