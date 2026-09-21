'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { secondaryBtnCls } from '@/components/settings/settings-utils'
import { TEST_PRODUCTS, type TestProduct } from '@/lib/test-kit/nav'

type ProductMetrics = {
  funnel: Record<string, number>
  shares: number
  attributions: number
  shareRate: number | null
  abandonment: { sessions: number; medianFurthest: number | null }
}

type Metrics = { products: Record<string, ProductMetrics> }

const PRODUCT_LABEL: Record<TestProduct, string> = {
  mbti: 'MBTI',
  iq: 'IQ',
}

/**
 * Funnel steps, in the order someone moves through them.
 *
 * One list for every product rather than a per-product list: a step a product never emits
 * reads 0, and a 0 is information - it is how you notice that IQ was not recording
 * `paywall-seen` at all. A per-product list would have hidden that by construction.
 */
const FUNNEL_STEPS: { event: string; label: string }[] = [
  { event: 'result-viewed', label: 'Result viewed' },
  { event: 'paywall-seen', label: 'Paywall seen' },
  { event: 'checkout-started', label: 'Checkout started' },
  { event: 'paid', label: 'Paid' },
  { event: 'waived', label: 'Waived (low effort)' },
]

/**
 * The funnel, per product, in one screen.
 *
 * Exists because a counter nobody reads is a counter nobody writes twice. Querying Mongo
 * by hand is something you do once, feel clever about, and then never do again - so the
 * data would accumulate and the decision it was collected for would still get made on a
 * hunch.
 */
export default function MetricsBoard() {
  const [data, setData] = useState<Metrics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/metrics')
      .then(response =>
        response.ok ? response.json() : Promise.reject(new Error('unavailable'))
      )
      .then(json => {
        if (!cancelled) setData(json as Metrics)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load metrics.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="text-pp-muted">{error}</p>
  if (!data) return <p className="text-pp-muted">Loading…</p>

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold text-pp-text">
          Funnel
        </h1>
        {/* The other two owner surfaces, so all three reach each other from any of them. */}
        <nav className="flex flex-wrap items-center gap-2.5">
          <Link
            className={secondaryBtnCls}
            href="/admin/settings"
          >
            Edit profile
          </Link>
          <Link
            className={secondaryBtnCls}
            href="/admin/publish"
          >
            Publish
          </Link>
        </nav>
      </div>

      {/*
        Two columns from `lg` up, stacked below it.

        `lg` (960px) rather than `md`: inside `max-w-editorial` a two-column split at md
        leaves each column around 330px, and the widest row here - "Sessions that left
        unfinished" against its number - starts wrapping. At lg each column is ~520px,
        which those rows fit comfortably.

        `items-start` so a product with fewer rows does not stretch its panel to match the
        taller one, which would leave a block of empty card.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
        {TEST_PRODUCTS.map(product => (
          <ProductSection
            key={product}
            label={PRODUCT_LABEL[product]}
            metrics={data.products?.[product]}
          />
        ))}
      </div>

      {/*
        The one asymmetry that would otherwise make these two columns silently
        incomparable. Stated on the page rather than in a code comment because the person
        reading a number here is the person who needs to know it.
      */}
      <p className="text-xs leading-relaxed text-pp-muted">
        Reading the two side by side: MBTI emits <code>result-viewed</code> and{' '}
        <code>paywall-seen</code> as mutually exclusive, so its arrivals are the
        sum of the two. IQ emits <code>result-viewed</code> for every arrival
        and <code>paywall-seen</code> as the locked subset of it. Conversion is{' '}
        <code>paid ÷ (result-viewed + paywall-seen)</code> for MBTI and{' '}
        <code>paid ÷ result-viewed</code> for IQ. IQ&apos;s{' '}
        <code>paywall-seen</code> only starts counting from now, so it will read
        low against its older <code>result-viewed</code> total for a while.
      </p>
    </div>
  )
}

/**
 * A panel rather than a bare column.
 *
 * Side by side, two borderless columns whose rows all carry a `border-b` line up into what
 * reads as a single four-column table - the eye pairs "Result viewed" with the number in
 * the OTHER product's column. The card boundary is what keeps each product's numbers
 * visibly its own.
 */
const PANEL = 'rounded-panel border border-pp-line bg-white/50 p-5 md:p-6'

function ProductSection({
  label,
  metrics,
}: {
  label: string
  metrics?: ProductMetrics
}) {
  if (!metrics)
    return (
      <section className={PANEL}>
        <h2 className="font-display text-xl font-semibold text-pp-text">
          {label}
        </h2>
        <p className="mt-3 text-pp-muted">No data for this product yet.</p>
      </section>
    )

  const steps = FUNNEL_STEPS.map(step => ({
    ...step,
    value: metrics.funnel[step.event] ?? 0,
  }))
  const empty =
    metrics.shares === 0 &&
    metrics.abandonment.sessions === 0 &&
    steps.every(step => step.value === 0)

  return (
    <section className={`${PANEL} space-y-8`}>
      <h2 className="font-display text-xl font-semibold text-pp-text">
        {label}
      </h2>

      {empty ? (
        // An empty state, not a broken chart. Zero is the expected reading for a while,
        // and it should look deliberate rather than like the page failed.
        <p className="text-pp-muted">
          Nothing recorded yet. Numbers appear once someone reaches a result or
          shares one.
        </p>
      ) : null}

      <Group title="Funnel">
        {steps.map(step => (
          <Row
            key={step.event}
            label={step.label}
            value={step.value}
          />
        ))}
      </Group>

      <Group
        title="The loop"
        footnote="Arrivals per share is the decision number. Below ~0.3 the loop is not spinning and the certificate wedge is unproven; above ~1 each share brings more than one person."
      >
        <Row
          label="Shares"
          value={metrics.shares}
        />
        <Row
          label="Arrivals from a share"
          value={metrics.attributions}
        />
        <Row
          label="Arrivals per share"
          value={
            metrics.shareRate === null ? '-' : metrics.shareRate.toFixed(2)
          }
        />
      </Group>

      <Group
        title="Abandonment"
        footnote="Feeds each test's length and time limit, which are otherwise chosen by copying whoever we are modelling."
      >
        <Row
          label="Sessions that left unfinished"
          value={metrics.abandonment.sessions}
        />
        <Row
          label="Median question reached"
          value={metrics.abandonment.medianFurthest ?? '-'}
        />
      </Group>
    </section>
  )
}

function Group({
  title,
  footnote,
  children,
}: {
  title: string
  footnote?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-muted">
        {title}
      </h3>
      <dl className="mt-3 space-y-2">{children}</dl>
      {footnote ? (
        <p className="mt-3 text-xs text-pp-muted">{footnote}</p>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-pp-line pb-2">
      <dt className="text-pp-muted">{label}</dt>
      <dd className="font-display text-lg font-semibold tabular-nums text-pp-text">
        {value}
      </dd>
    </div>
  )
}
