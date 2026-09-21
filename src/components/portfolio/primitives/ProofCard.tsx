import type { HTMLAttributes, ReactNode } from 'react'

import { EditorialPanel } from './EditorialPanel'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

export type ProofCardProps = {
  children: ReactNode
  /** Eyebrow / category */
  kicker?: string
  title?: ReactNode
  /** Visual anchor: logo slot, icon, or mark */
  media?: ReactNode
  footer?: ReactNode
  className?: string
  panelClassName?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'title'>

/**
 * Proof-first module: quote, press line, credential - keep copy real in sections.
 */
export function ProofCard({
  children,
  kicker,
  title,
  media,
  footer,
  className,
  panelClassName,
  ...rest
}: ProofCardProps) {
  return (
    <EditorialPanel
      className={cx('overflow-hidden p-0', panelClassName)}
      {...rest}
    >
      <div
        className={cx(
          'flex flex-col gap-4 p-5 sm:p-6 md:flex-row md:items-start md:gap-6',
          className
        )}
      >
        {media ? (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-pp-line bg-pp-panel-strong font-display text-lg font-semibold text-pp-text md:h-14 md:w-14">
            {media}
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          {kicker ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
              {kicker}
            </p>
          ) : null}
          {title ? (
            <div className="font-display text-lg font-semibold leading-snug text-pp-text md:text-xl">
              {title}
            </div>
          ) : null}
          <div className="text-base leading-relaxed text-pp-muted [&_strong]:font-semibold [&_strong]:text-pp-text">
            {children}
          </div>
          {footer ? (
            <div className="pt-1 text-sm text-pp-muted">{footer}</div>
          ) : null}
        </div>
      </div>
    </EditorialPanel>
  )
}
