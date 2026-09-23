import { EyeOff, TriangleAlert } from 'lucide-react'

import { meaningStyle } from '@/components/whiteboard/meaning-style'
import { cn } from '@/lib/utils'
import type { Meaning } from '@/lib/whiteboard/limits'

export function MeaningChip({
  meaning,
  className,
}: {
  meaning: Meaning | null
  className?: string
}) {
  const style = meaningStyle(meaning)
  const Icon = style.Icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[3px] font-display text-[10px] font-semibold uppercase tracking-[0.1em]',
        style.chipCls,
        className
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden
          size={11}
        />
      ) : null}
      {style.label}
    </span>
  )
}

/** Hidden state is never colour alone (DR9): an icon with a label for assistive tech. */
export function HiddenBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('text-pp-muted', className)}
      title="Hidden from AI"
    >
      <EyeOff
        aria-label="Hidden from AI"
        size={14}
      />
    </span>
  )
}

export function ErrorBadge({ message }: { message: string }) {
  return (
    <span
      className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-pp-ink-rose text-white shadow"
      title={message}
    >
      <TriangleAlert
        aria-label={`Not saved: ${message}`}
        size={12}
      />
    </span>
  )
}
