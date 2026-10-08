import {
  badgeFor,
  type BadgeTone,
  type IndexingSummary,
  type IndexStatus,
} from '@/lib/blog/index-status-badge'
import { cn } from '@/lib/utils'

/**
 * One published post's Google index status, as the coloured dot that leads its `/admin/blog`
 * row.
 *
 * It used to be a text pill beside the title ("Unknown to Google"), which took a third of a
 * narrow row and pushed the title into an ellipsis on every published post. The dot sits in
 * the slot the plain "published" bullet already had, so the colour carries the status and the
 * full text moves into a hover / focus tooltip.
 *
 * The rules live in `lib/blog/index-status-badge.ts`; this only paints them. When a check has
 * run, the dot links to that URL's Search Console inspection page - which is where the manual
 * "Request indexing" button lives, since Google offers no API for it.
 *
 * The tooltip is CSS, not `title`: the native one waits about a second, never shows on
 * keyboard focus, and cannot be styled. It opens to the right and downward, over the row's own title, and
 * the row lifts itself on hover (`hover:z-20` in `BlogBoard`) so a multi-line tooltip is not
 * painted under the next row.
 */

const dotCls: Record<BadgeTone, string> = {
  green: 'bg-pp-green',
  amber: 'bg-pp-orange',
  rose: 'bg-pp-pink',
  muted: 'bg-pp-muted/60',
}

const labelCls: Record<BadgeTone, string> = {
  green: 'text-pp-ink-green',
  amber: 'text-pp-ink-amber',
  rose: 'text-pp-ink-rose',
  muted: 'text-pp-text',
}

export default function IndexStatusDot({
  status,
  indexing,
  checking = false,
  className,
}: {
  status: IndexStatus | null | undefined
  indexing: IndexingSummary
  checking?: boolean
  className?: string
}) {
  const badge = badgeFor(status, indexing)
  const label = checking ? 'Checking...' : badge.label
  const details = checking ? ['Asking Google...'] : badge.details
  const link = checking ? null : badge.link

  const dot = (
    <span
      aria-hidden
      className={cn(
        'block h-2.5 w-2.5 rounded-full transition-transform group-hover/index:scale-125',
        dotCls[badge.tone],
        checking && 'animate-pulse',
        // A newer re-check failed while an older result is still shown.
        badge.staleError && !checking && 'ring-2 ring-pp-pink/50 ring-offset-1'
      )}
    />
  )
  const tooltip = (
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute -top-2 left-full z-30 ml-2 w-max max-w-[16rem] rounded-[0.9rem] border border-pp-line bg-white px-3 py-2 text-left text-[11px] font-normal leading-snug text-pp-muted opacity-0 shadow-[0_14px_30px_rgba(46,35,28,0.12)] transition-opacity group-focus-within/index:visible group-focus-within/index:opacity-100 group-hover/index:visible group-hover/index:opacity-100"
    >
      <span className={cn('block font-semibold', labelCls[badge.tone])}>
        Google: {label}
      </span>
      {details.map((line, i) => (
        <span
          key={`${i}-${line}`}
          className="block break-words"
        >
          {line}
        </span>
      ))}
      {link ? (
        <span className="mt-1 block text-pp-blue">Open in Search Console</span>
      ) : null}
    </span>
  )
  const triggerCls =
    'flex h-4 w-4 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pp-blue'

  return (
    <span className={cn('group/index relative inline-flex', className)}>
      {link ? (
        <a
          className={cn(triggerCls, 'cursor-pointer')}
          href={link}
          rel="noreferrer"
          target="_blank"
          aria-label={`Google: ${label}. Open in Search Console`}
        >
          {dot}
        </a>
      ) : (
        <span
          className={triggerCls}
          tabIndex={0}
          role="img"
          aria-label={`Google: ${label}`}
        >
          {dot}
        </span>
      )}
      {tooltip}
    </span>
  )
}
