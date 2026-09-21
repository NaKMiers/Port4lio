import type { HTMLAttributes, ReactNode } from 'react'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type EditorialPanelVariant = 'default' | 'strong'

export type EditorialPanelProps = {
  children: ReactNode
  variant?: EditorialPanelVariant
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'>

const variantClass: Record<EditorialPanelVariant, string> = {
  default:
    'border-pp-line bg-pp-panel text-pp-text shadow-panel backdrop-blur-md',
  strong:
    'border-pp-line bg-pp-panel-strong text-pp-text shadow-panel backdrop-blur-sm',
}

/**
 * Frosted paper-like surface; not a generic glassmorphism card.
 */
export function EditorialPanel({
  children,
  variant = 'default',
  className,
  ...rest
}: EditorialPanelProps) {
  return (
    <div
      className={cx(
        'rounded-panel border border-solid',
        variantClass[variant],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
