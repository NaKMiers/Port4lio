import type { AnchorHTMLAttributes, ReactNode } from 'react'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

function isExternalHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href.trim())
}

export type PortfolioExternalLinkProps = {
  href: string
  children: ReactNode
  className?: string
  /** Announced when opening in a new tab */
  newTabHint?: boolean
} & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href' | 'className' | 'children'
>

/**
 * External https links open in a new tab with noreferrer; same-origin / relative stay in-page.
 */
export function PortfolioExternalLink({
  href,
  children,
  className,
  newTabHint = true,
  ...rest
}: PortfolioExternalLinkProps) {
  const external = isExternalHttpUrl(href)
  return (
    <a
      href={href}
      className={cx(className)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    >
      {children}
      {external && newTabHint ? (
        <span className="sr-only"> (opens in a new tab)</span>
      ) : null}
    </a>
  )
}
