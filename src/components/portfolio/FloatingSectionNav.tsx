'use client'

import { FolderGit2, Home, Layers, Mail, Quote, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  PORTFOLIO_NAV_SECTIONS,
  type PortfolioNavSectionId,
} from '@/lib/portfolio-section-nav'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

const ICONS = {
  hero: Home,
  about: UserRound,
  services: Layers,
  work: FolderGit2,
  testimonials: Quote,
  contact: Mail,
} as const

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function FloatingSectionNav() {
  const ids = useMemo(
    () => PORTFOLIO_NAV_SECTIONS.map(s => s.id as PortfolioNavSectionId),
    []
  )
  const [active, setActive] = useState<PortfolioNavSectionId>('hero')

  const updateActive = useCallback(() => {
    const marker = 112
    let current: PortfolioNavSectionId = ids[0]
    for (const id of ids) {
      const el = document.getElementById(id)
      if (!el) continue
      const top = el.getBoundingClientRect().top
      if (top <= marker) current = id
    }
    setActive(current)
  }, [ids])

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        updateActive()
      })
    }
    const frame = requestAnimationFrame(onScroll)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [updateActive])

  const scrollToHash = (hash: string) => {
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    const id = hash.replace(/^#/, '')
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior, block: 'start' })
  }

  return (
    <nav
      aria-label="Section quick navigation"
      className={cx(
        'pointer-events-none fixed z-50',
        'bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 right-3',
        'md:bottom-auto md:left-auto md:right-4 md:top-1/2 md:w-auto md:-translate-y-1/2 xl:right-6'
      )}
    >
      <div
        className={cx(
          'pointer-events-auto flex items-center justify-center gap-1.5 overflow-x-auto rounded-[1.75rem] border border-pp-line bg-pp-panel/95 p-2 shadow-panel backdrop-blur-md',
          'motion-safe:transition-[box-shadow,transform] motion-safe:duration-300',
          'md:flex-col md:items-stretch md:overflow-visible md:rounded-[2rem] md:px-2 md:py-3',
          'no-scrollbar'
        )}
      >
        {PORTFOLIO_NAV_SECTIONS.map(({ id, label }) => {
          const Icon = ICONS[id]
          const isActive = active === id
          const href = `#${id}`
          return (
            <Link
              key={id}
              href={href}
              scroll={false}
              prefetch={false}
              title={label}
              aria-label={label}
              aria-current={isActive ? 'true' : undefined}
              className={cx(
                'group/nav-item relative flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-transparent px-2.5 py-2 text-sm font-semibold text-pp-text',
                'transition-[background-color,border-color,color,box-shadow] duration-200 ease-out',
                'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:hover:-translate-y-0.5 md:motion-safe:hover:-translate-x-1 md:motion-safe:hover:-translate-y-0 md:motion-safe:hover:scale-[1.06]',
                'hover:border-pp-line hover:bg-pp-panel-strong',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue',
                isActive &&
                  'border-pp-line bg-pp-panel-strong shadow-[0_8px_28px_rgba(46,35,28,0.08)]',
                'md:h-11 md:w-11 md:px-0',
                isActive && 'md:bg-white/92'
              )}
              onClick={e => {
                e.preventDefault()
                scrollToHash(href)
                if (typeof window !== 'undefined')
                  window.history.replaceState(null, '', href)
              }}
            >
              <span
                className={cx(
                  'absolute inset-0 rounded-full opacity-0 motion-safe:transition-opacity motion-safe:duration-300',
                  isActive && 'opacity-100'
                )}
                aria-hidden
              >
                <span className="pp-pulse-soft absolute inset-[7px] rounded-full bg-[radial-gradient(circle,rgba(255,159,64,0.14),rgba(255,159,64,0))]" />
              </span>
              <Icon
                className={cx(
                  'relative z-[1] h-4 w-4 shrink-0 transition-colors duration-200 ease-out motion-safe:transition-transform motion-safe:duration-200',
                  isActive
                    ? 'scale-110 text-pp-text'
                    : 'text-pp-muted motion-safe:group-hover/nav-item:scale-110',
                  'group-hover/nav-item:text-pp-text'
                )}
                aria-hidden
              />
              <span
                className={cx(
                  'md:bg-white/92 sr-only pointer-events-none md:not-sr-only md:absolute md:left-auto md:right-full md:top-1/2 md:z-[60] md:mr-3 md:-translate-x-2 md:-translate-y-1/2 md:whitespace-nowrap md:rounded-full md:border md:border-pp-line md:px-3 md:py-1.5 md:text-xs md:font-semibold md:uppercase md:tracking-[0.16em] md:text-pp-text md:opacity-0 md:shadow-[0_12px_26px_rgba(46,35,28,0.08)] md:transition-[opacity,transform] md:duration-200 md:ease-out',
                  'md:group-focus-within/nav-item:-translate-y-1/2 md:group-focus-within/nav-item:translate-x-0 md:group-focus-within/nav-item:opacity-100 md:group-hover/nav-item:-translate-y-1/2 md:group-hover/nav-item:translate-x-0 md:group-hover/nav-item:opacity-100',
                  isActive &&
                    'md:-translate-y-1/2 md:translate-x-0 md:opacity-100'
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
