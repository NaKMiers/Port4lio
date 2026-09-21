'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Award, BriefcaseBusiness, GraduationCap } from 'lucide-react'
import { useMemo, useState } from 'react'

import { formatPortfolioPeriod } from '@/lib/profile-copy'
import type {
  Certificate,
  EducationItem,
  ExperienceItem,
} from '@/types/profile'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type AboutTimelineTabsProps = {
  experience: ExperienceItem[]
  education: EducationItem[]
  certificates: Certificate[]
}

type TabId = 'experience' | 'education' | 'credentials'

type TimelineEntry = {
  id: string
  kicker: string
  title: string
  body: string
  href?: string
}

const tabMeta: Record<
  TabId,
  {
    label: string
    accent: string
    Icon: typeof BriefcaseBusiness
  }
> = {
  experience: {
    label: 'Experience',
    accent: 'from-pp-blue/20 via-pp-blue/8 to-transparent',
    Icon: BriefcaseBusiness,
  },
  education: {
    label: 'Education',
    accent: 'from-pp-green/20 via-pp-green/8 to-transparent',
    Icon: GraduationCap,
  },
  credentials: {
    label: 'Credentials',
    accent: 'from-pp-orange/20 via-pp-pink/8 to-transparent',
    Icon: Award,
  },
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

function buildExperienceItems(items: ExperienceItem[]): TimelineEntry[] {
  return items.map((item, index) => ({
    id: `experience-${index}-${item.companyName}-${item.position}`,
    kicker: formatPortfolioPeriod(item.start, item.end),
    title: item.position || 'Role',
    body: item.companyName || 'Client or company',
  }))
}

function buildEducationItems(items: EducationItem[]): TimelineEntry[] {
  return items.map((item, index) => ({
    id: `education-${index}-${item.schoolName}-${item.major}`,
    kicker: formatPortfolioPeriod(item.start, item.end),
    title: item.major || 'Program',
    body: item.schoolName || 'School',
  }))
}

function buildCertificateItems(items: Certificate[]): TimelineEntry[] {
  return items.map((item, index) => ({
    id: `credential-${index}-${item.name}`,
    kicker: 'Verified learning',
    title: item.name || 'Certificate',
    body: item.link?.trim()
      ? 'Open credential'
      : 'Credential recorded in portfolio',
    href: item.link?.trim() || undefined,
  }))
}

export default function AboutTimelineTabs({
  experience,
  education,
  certificates,
}: AboutTimelineTabsProps) {
  const tabs = useMemo(
    () =>
      [
        {
          id: 'experience' as const,
          items: buildExperienceItems(experience),
        },
        {
          id: 'education' as const,
          items: buildEducationItems(education),
        },
        {
          id: 'credentials' as const,
          items: buildCertificateItems(certificates),
        },
      ].filter(tab => tab.items.length > 0),
    [certificates, education, experience]
  )

  const [active, setActive] = useState<TabId>(tabs[0]?.id ?? 'experience')
  const activeTab = tabs.find(tab => tab.id === active) ?? tabs[0]

  if (!activeTab) return null

  return (
    <div className="relative overflow-hidden rounded-panel border border-pp-line bg-pp-panel-strong/95 p-4 shadow-panel backdrop-blur-md sm:p-5">
      <div
        className={cx(
          'pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b opacity-90',
          tabMeta[activeTab.id].accent
        )}
        aria-hidden
      />

      <div className="relative space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
              Career timeline
            </p>
            <h3 className="mt-1 font-display text-lg font-semibold tracking-tight text-pp-text">
              Experience, education, and proof
            </h3>
          </div>
          <div className="hidden rounded-full border border-pp-line bg-white/70 px-3 py-1 text-xs font-semibold text-pp-muted sm:block">
            {activeTab.items.length} entries
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {tabs.map(tab => {
            const meta = tabMeta[tab.id]
            const Icon = meta.Icon
            const isActive = tab.id === activeTab.id

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={cx(
                  'group relative flex min-h-[60px] items-center gap-2 overflow-hidden rounded-2xl border px-2 py-3 text-left',
                  'motion-safe:duration-250 motion-safe:transition-[transform,border-color,background-color,box-shadow] motion-safe:hover:-translate-y-0.5',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue',
                  isActive
                    ? 'border-pp-line bg-white/90 shadow-[0_14px_36px_rgba(46,35,28,0.08)]'
                    : 'border-pp-line/75 bg-white/55 hover:bg-white/80'
                )}
                aria-pressed={isActive}
              >
                {isActive ? (
                  <motion.span
                    layoutId="about-tab-pill"
                    className={cx(
                      'absolute inset-0 rounded-2xl bg-gradient-to-br',
                      meta.accent
                    )}
                    transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                    aria-hidden
                  />
                ) : null}
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-pp-line bg-white/85 text-pp-text shadow-[0_8px_18px_rgba(46,35,28,0.06)]">
                  <Icon
                    className="h-4 w-4"
                    aria-hidden
                  />
                </span>
                <span className="relative min-w-0">
                  <span className="block font-display text-sm font-semibold text-pp-text">
                    {meta.label}
                  </span>
                  <span className="block text-xs text-pp-muted">
                    {tab.items.length} entries
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="bg-white/82 relative min-h-[18rem] overflow-hidden rounded-[1.35rem] border border-pp-line px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:px-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-3"
            >
              {activeTab.items.map((item, index) => (
                <article
                  key={item.id}
                  className="bg-white/92 rounded-2xl border border-pp-line/80 p-4 shadow-[0_10px_24px_rgba(46,35,28,0.05)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      {item.kicker ? (
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted">
                          {item.kicker}
                        </p>
                      ) : null}
                      <h4 className="font-display text-base font-semibold leading-snug text-pp-text">
                        {item.title}
                      </h4>
                    </div>
                    <div className="rounded-full border border-pp-line bg-pp-panel px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted">
                      {String(index + 1).padStart(2, '0')}
                    </div>
                  </div>

                  {item.href ? (
                    <a
                      href={item.href}
                      className="mt-2 inline-flex text-sm font-medium text-pp-text underline decoration-pp-blue/45 underline-offset-[0.2em] hover:decoration-pp-blue"
                      {...(isExternalHref(item.href)
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {item.body}
                      {isExternalHref(item.href) ? (
                        <span className="sr-only"> (opens in a new tab)</span>
                      ) : null}
                    </a>
                  ) : (
                    <p className="mt-2 text-sm leading-relaxed text-pp-muted">
                      {item.body}
                    </p>
                  )}
                </article>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
