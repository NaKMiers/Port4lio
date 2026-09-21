import type { PublishDrift } from '@/lib/publish/types'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** Fixed UTC formatting so server and client markup agree, as elsewhere in the repo. */
function formatDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? DATE_FORMATTER.format(date) : ''
}

const inSyncCls =
  'rounded-full border border-pp-line bg-white/82 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'
const driftCls =
  'rounded-full border border-pp-orange/30 bg-pp-orange/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-text'
const failedCls =
  'rounded-full border border-[#c98a8a] bg-[#fdf3f3] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7f2f2f]'

/**
 * Purely presentational. A target reads as in sync only because something asserted it -
 * the workflow reporting a push, or the owner pressing "Mark as pasted".
 */
export default function DriftBadge({ drift }: { drift: PublishDrift }) {
  if (drift.lastResult === 'failed') {
    const when = formatDate(drift.lastRunAt)
    return (
      <span className={failedCls}>
        Last run failed{when ? ` · ${when}` : ''}
      </span>
    )
  }

  if (drift.inSync) {
    const when = formatDate(drift.ackedAt)
    return <span className={inSyncCls}>In sync{when ? ` · ${when}` : ''}</span>
  }

  const changed = formatDate(drift.driftSince)
  const pasted = formatDate(drift.ackedAt)

  if (!drift.ackedVersion)
    return <span className={driftCls}>Never published</span>

  return (
    <span className={driftCls}>
      Out of date{pasted ? ` · last ${pasted}` : ''}
      {changed ? ` · changed ${changed}` : ''}
    </span>
  )
}
