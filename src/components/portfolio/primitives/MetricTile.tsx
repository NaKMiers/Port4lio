import AnimatedCounter from '@/components/portfolio/client/AnimatedCounter'
import type { ReactNode } from 'react'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

export type MetricTileProps = {
  label: string
  value: string
  /** Optional hint under the value */
  hint?: string
  className?: string
  /** E.g. accent dot or icon */
  adornment?: ReactNode
}

/**
 * Tight stat cell: display numeral + subdued label (reference: authority metrics).
 */
export function MetricTile({
  label,
  value,
  hint,
  className,
  adornment,
}: MetricTileProps) {
  return (
    <div
      className={cx(
        'flex flex-col gap-1 rounded-panel border border-pp-line bg-pp-panel-strong px-4 py-3 shadow-[0_12px_40px_rgba(46,35,28,0.06)] sm:px-5 sm:py-4',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-display text-2xl font-semibold tracking-tight text-pp-text md:text-3xl">
          <AnimatedCounter value={value} />
        </div>
        {adornment ? (
          <span className="shrink-0 text-pp-muted">{adornment}</span>
        ) : null}
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pp-muted">
        {label}
      </p>
      {hint ? <p className="text-sm text-pp-muted">{hint}</p> : null}
    </div>
  )
}
