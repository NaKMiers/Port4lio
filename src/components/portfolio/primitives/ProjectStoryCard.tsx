import type { HTMLAttributes, ReactNode } from 'react'

import { EditorialPanel } from './EditorialPanel'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

export type ProjectStoryCardProps = {
  children: ReactNode
  /** Short label above title */
  meta?: string
  title: ReactNode
  /** Thumbnail or decorative block */
  visual?: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'title'>

/**
 * Project teaser surface; sections compose media + links on top of this base.
 */
export function ProjectStoryCard({
  children,
  meta,
  title,
  visual,
  className,
  ...rest
}: ProjectStoryCardProps) {
  return (
    <EditorialPanel
      variant="strong"
      className={cx('flex flex-col overflow-hidden p-0', className)}
      {...rest}
    >
      {visual ? (
        <div className="border-b border-pp-line bg-pp-bg/40">{visual}</div>
      ) : null}
      <div className="flex flex-1 flex-col space-y-3 p-5 sm:p-6">
        {meta ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted">
            {meta}
          </p>
        ) : null}
        <h3 className="font-display text-xl font-semibold tracking-tight text-pp-text">
          {title}
        </h3>
        <div className="flex-1 text-sm leading-relaxed [&_p]:text-pp-muted">
          {children}
        </div>
      </div>
    </EditorialPanel>
  )
}
