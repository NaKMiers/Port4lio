import type { HTMLAttributes, ReactNode } from 'react'

import RevealOnScroll from '@/components/portfolio/client/RevealOnScroll'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

export type SectionFrameProps = {
  children: ReactNode
  /** Stable anchor, e.g. `about` → `#about` */
  id?: string
  /** Extra wrapper classes */
  className?: string
  /** Inner container classes */
  innerClassName?: string
  revealVariant?: 'section' | 'dramatic' | 'soft'
  revealDelay?: number
  disableReveal?: boolean
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children' | 'id'>

/**
 * Vertical rhythm + max-width column aligned with the editorial reference (`--pp-max`).
 */
export function SectionFrame({
  children,
  id,
  className,
  innerClassName,
  revealVariant = 'section',
  revealDelay = 0,
  disableReveal = false,
  ...sectionProps
}: SectionFrameProps) {
  return (
    <section
      id={id}
      className={cx('relative scroll-mt-20 py-section', className)}
      {...sectionProps}
    >
      <div
        className={cx(
          'mx-auto w-full max-w-editorial px-gutter',
          innerClassName
        )}
      >
        {disableReveal ? (
          children
        ) : (
          <RevealOnScroll
            variant={revealVariant}
            delay={revealDelay}
          >
            {children}
          </RevealOnScroll>
        )}
      </div>
    </section>
  )
}
