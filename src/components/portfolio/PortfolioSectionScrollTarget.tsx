'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

import { PORTFOLIO_NAV_SECTION_ID_SET } from '@/lib/portfolio-section-nav'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Honors `?section=` on `/` without forcing the page itself dynamic.
 * Smooth scroll runs after hydration; invalid values are ignored.
 */
export default function PortfolioSectionScrollTarget() {
  const searchParams = useSearchParams()
  const requestedSection = searchParams.get('section')

  useEffect(() => {
    const id = requestedSection?.toLowerCase().trim()
    if (!id || !PORTFOLIO_NAV_SECTION_ID_SET.has(id)) return

    requestAnimationFrame(() => {
      const el =
        typeof document !== 'undefined' ? document.getElementById(id) : null
      const behavior: ScrollBehavior = prefersReducedMotion()
        ? 'auto'
        : 'smooth'
      el?.scrollIntoView({ behavior, block: 'start' })
    })
  }, [requestedSection])

  return null
}
