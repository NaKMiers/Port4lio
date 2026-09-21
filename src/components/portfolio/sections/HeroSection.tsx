import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { MetricTile } from '@/components/portfolio/primitives/MetricTile'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { collapseWhitespace, excerptText } from '@/lib/profile-copy'
import type { HeroViewModel } from '@/lib/profile-view-model'
import type { ProjectItem } from '@/types/profile'
import Link from 'next/link'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type HeroSectionProps = {
  hero: HeroViewModel
  featuredProjects: ProjectItem[]
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0]
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1]
  return (a ?? '?').toUpperCase() + (b ?? '').toUpperCase()
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

function anchorExternalProps(href: string): { target?: string; rel?: string } {
  return isExternalHref(href)
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {}
}

function boardProjects(projects: ProjectItem[]): ProjectItem[] {
  return projects
    .filter(p => collapseWhitespace(p.title).length > 0)
    .slice(0, 3)
}

/** Clean job titles like "a Software Engineer" for compact labels. */
function stripLeadingArticle(title: string): string {
  return collapseWhitespace(title.replace(/^(a|an)\s+/i, '').trim())
}

function firstHttpLink(project: ProjectItem): string | null {
  for (const part of project.parts) {
    const link = part.link?.trim() ?? ''
    if (/^https?:\/\//i.test(link)) return link
  }
  return null
}

function BoardProjectCard({ project }: { project: ProjectItem }) {
  const leadPart = project.parts[0]
  const excerpt = excerptText(leadPart?.description ?? '', 100)
  const link = firstHttpLink(project)
  return (
    <EditorialPanel
      variant="default"
      className={cx(
        'p-4 sm:p-5',
        'motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-0.5'
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
        Shipped work
      </p>
      <p className="mt-1 font-display text-base font-semibold leading-snug text-pp-text sm:text-lg">
        {collapseWhitespace(project.title)}
      </p>
      {excerpt ? (
        <p className="mt-2 text-sm leading-relaxed text-pp-muted">{excerpt}</p>
      ) : null}
      {link ? (
        <a
          href={link}
          className="mt-3 inline-flex text-sm font-semibold text-pp-text underline decoration-pp-blue/50 underline-offset-[0.2em] hover:decoration-pp-blue"
          {...anchorExternalProps(link)}
        >
          Open project link
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
    </EditorialPanel>
  )
}

/** Above-the-fold editorial hero, now with stronger portrait scale + livelier signal chips. */
export default function HeroSection({
  hero,
  featuredProjects,
}: HeroSectionProps) {
  const eyebrow =
    hero.jobTitles.length > 0
      ? hero.jobTitles.join(' · ')
      : hero.username
        ? `@${hero.username}`
        : null

  const boards = boardProjects(featuredProjects)
  const marqueeFacts = [
    ...hero.jobTitles.slice(0, 3),
    ...hero.stats.slice(0, 3).map(stat => `${stat.value}+ ${stat.label}`),
  ].filter(Boolean)
  const portraitLabel =
    collapseWhitespace(hero.fullName) ||
    collapseWhitespace(hero.headline) ||
    'Portfolio portrait'
  const projectSignal = boards[0]?.title
    ? `${collapseWhitespace(boards[0].title)} is already live.`
    : hero.jobTitles[0]
      ? `${hero.jobTitles[0]} with a bias toward shipping.`
      : hero.description

  const roleLine =
    hero.jobTitles.length > 0
      ? hero.jobTitles
          .map(stripLeadingArticle)
          .filter(Boolean)
          .slice(0, 3)
          .join(' · ')
      : ''

  const heroSidekickEyebrow =
    roleLine.length > 0 ? roleLine : 'Live profile snapshot'

  const primaryStat = hero.stats[0]
  const heroSidekickBody =
    primaryStat && roleLine.length > 0
      ? `From client launches to production apps - ${primaryStat.value}+ ${primaryStat.label.toLowerCase()} anchors the story, and every block here reflects my live portfolio data.`
      : collapseWhitespace(hero.description).length > 0
        ? excerptText(collapseWhitespace(hero.description), 158)
        : 'Shipped projects, metrics, and story blocks hydrate straight from your portfolio profile-refresh the data upstream and this hero follows.'

  return (
    <SectionFrame
      id="hero"
      aria-labelledby="hero-heading"
      disableReveal
      className="relative scroll-mt-24 overflow-hidden border-b border-pp-line pb-section pt-8 md:scroll-mt-28 md:pt-12"
    >
      {hero.backgroundImageUrl ? (
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.085] motion-safe:transition-opacity"
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN URLs from profile */}
          <img
            src={hero.backgroundImageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
          <div className="via-[var(--pp-bg)]/80 absolute inset-0 bg-gradient-to-b from-[var(--pp-bg)] to-[var(--pp-bg)]" />
        </div>
      ) : null}

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,460px)] lg:gap-14 xl:gap-16">
        <div className="space-y-6 md:space-y-8">
          {eyebrow ? (
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-pp-muted">
              {eyebrow}
            </p>
          ) : null}

          <div className="space-y-4">
            <div className="inline-flex items-center gap-3 rounded-full border border-pp-line/80 bg-white/70 px-4 py-2 shadow-[0_12px_28px_rgba(46,35,28,0.06)] backdrop-blur-md">
              <span
                className="h-2.5 w-2.5 rounded-full bg-[linear-gradient(135deg,var(--pp-orange),#ffd98b)] shadow-[0_0_0_8px_rgba(255,159,64,0.12)]"
                aria-hidden
              />
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-pp-text">
                Available for bold builds
              </span>
            </div>

            <h1
              id="hero-heading"
              className="font-display text-[clamp(2.25rem,5vw,3.75rem)] font-semibold leading-[1.08] tracking-tight text-pp-text"
            >
              {hero.headline}
            </h1>
            {hero.subheadline ? (
              <p className="max-w-2xl font-display text-lg font-medium leading-snug text-pp-muted md:text-xl">
                {hero.subheadline}
              </p>
            ) : null}
            {hero.description ? (
              <p className="max-w-2xl text-base leading-relaxed text-pp-muted md:text-lg">
                {hero.description}
              </p>
            ) : null}
          </div>

          {marqueeFacts.length ? (
            <ul
              className="flex flex-wrap gap-2.5"
              aria-label="Quick portfolio signals"
            >
              {marqueeFacts.map((fact, index) => (
                <li key={`${fact}-${index}`}>
                  <span className="inline-flex items-center gap-2 rounded-full border border-pp-line bg-pp-panel-strong px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-pp-text shadow-[0_8px_18px_rgba(46,35,28,0.05)]">
                    <span
                      className={cx(
                        'h-2 w-2 rounded-full',
                        index % 4 === 0 && 'bg-pp-orange',
                        index % 4 === 1 && 'bg-pp-blue',
                        index % 4 === 2 && 'bg-pp-green',
                        index % 4 === 3 && 'bg-pp-pink'
                      )}
                      aria-hidden
                    />
                    {fact}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <a
              href="#work"
              className={cx(
                'inline-flex min-h-[48px] items-center justify-center rounded-full bg-pp-text px-6 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(17,17,17,0.18)]',
                'motion-safe:transition-[transform,box-shadow,background-color] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_22px_42px_rgba(17,17,17,0.22)]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
              )}
            >
              View selected work
            </a>
            <Link
              href="/cv"
              className={cx(
                'inline-flex min-h-[48px] items-center justify-center rounded-full border border-pp-line bg-pp-panel-strong px-6 py-3 text-sm font-semibold text-pp-text shadow-[0_12px_36px_rgba(46,35,28,0.06)]',
                'motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-0.5',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
              )}
            >
              View my CV
            </Link>
            <a
              href="#contact"
              className={cx(
                'inline-flex min-h-[48px] items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-pp-blue underline decoration-pp-blue/45 underline-offset-[0.22em] hover:decoration-pp-blue',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
              )}
            >
              Contact
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[32rem] space-y-5 lg:mx-0 lg:max-w-none">
          <EditorialPanel
            variant="strong"
            className={cx(
              'relative z-[2] overflow-hidden p-4 sm:p-5',
              'motion-safe:-rotate-[0.45deg] motion-safe:md:-rotate-[1.1deg]'
            )}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(51,152,255,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(243,143,209,0.16),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0))]" />
            <div
              className="pp-orbit absolute -right-12 top-8 h-32 w-32 rounded-full border border-white/80 opacity-80"
              aria-hidden
            />
            <div
              className="pp-pulse-soft absolute -left-10 bottom-16 h-24 w-24 rounded-full border border-[rgba(57,190,113,0.2)]"
              aria-hidden
            />

            <div className="relative space-y-4">
              <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,240,233,0.92))] p-3 shadow-[0_28px_60px_rgba(46,35,28,0.12)]">
                <div className="relative overflow-hidden rounded-[1.7rem] border border-pp-line bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.52),transparent_56%),linear-gradient(180deg,rgba(244,242,255,0.78),rgba(255,250,246,0.84))]">
                  <div className="absolute left-4 right-4 top-4 z-[2] flex items-center justify-between gap-3 rounded-[1.25rem] border border-white/85 bg-white/85 px-4 py-3 shadow-[0_16px_40px_rgba(46,35,28,0.12)] backdrop-blur-md">
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg font-semibold text-pp-text sm:text-xl">
                        {hero.fullName || hero.headline}
                      </p>
                      {hero.username ? (
                        <p className="text-sm font-medium text-pp-muted">
                          @{hero.username}
                        </p>
                      ) : null}
                    </div>
                    <span className="bg-white/92 inline-flex shrink-0 rounded-full border border-pp-line px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-text">
                      Signature
                    </span>
                  </div>

                  <div className="relative aspect-[4/5] min-h-[24rem] overflow-hidden rounded-[1.55rem] bg-[linear-gradient(180deg,rgba(232,228,255,0.42),rgba(255,236,217,0.32))]">
                    {hero.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- profile-managed URLs
                      <img
                        src={hero.avatarUrl}
                        alt={portraitLabel}
                        width={560}
                        height={700}
                        className="h-full w-full object-cover object-center"
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      <span
                        className="flex h-full w-full items-center justify-center font-display text-6xl font-semibold text-pp-muted"
                        aria-hidden
                      >
                        {initials(hero.fullName || hero.headline)}
                      </span>
                    )}

                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(24,20,18,0.06),transparent_28%,transparent_72%,rgba(24,20,18,0.18))]" />
                    <div className="bg-white/84 absolute bottom-4 left-4 right-auto rounded-[1.2rem] border border-white/80 px-4 py-3 shadow-[0_16px_36px_rgba(46,35,28,0.12)] backdrop-blur-md">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
                        Now shipping
                      </p>
                      <p className="mt-1 max-w-[13rem] text-sm font-semibold leading-snug text-pp-text">
                        {projectSignal}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="bg-white/82 rounded-[1.35rem] border border-pp-line px-4 py-3 shadow-[0_12px_24px_rgba(46,35,28,0.08)] backdrop-blur-md">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
                    {heroSidekickEyebrow}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-pp-text">
                    {heroSidekickBody}
                  </p>
                </div>
                <div className="flex items-center justify-center rounded-[1.35rem] border border-dashed border-pp-line bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(247,241,233,0.8))] px-4 py-3 text-center shadow-[0_12px_24px_rgba(46,35,28,0.06)]">
                  <span className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-pp-text">
                    Ship.
                    <br />
                    Earn.
                  </span>
                </div>
              </div>
            </div>
          </EditorialPanel>

          {hero.stats.length ? (
            <div
              className={cx(
                'relative z-[1] grid gap-3 sm:grid-cols-3',
                'motion-safe:translate-x-1 motion-safe:md:translate-x-2 motion-safe:md:rotate-[0.25deg]'
              )}
            >
              {hero.stats.slice(0, 3).map(stat => (
                <MetricTile
                  key={stat.label}
                  label={stat.label}
                  value={String(stat.value)}
                />
              ))}
            </div>
          ) : null}

          {boards.length ? (
            <div
              className={cx(
                'relative z-0 space-y-3',
                'motion-safe:-translate-x-1 motion-safe:md:-translate-x-2 motion-safe:md:rotate-[0.5deg]'
              )}
            >
              {boards.map((project, idx) => (
                <BoardProjectCard
                  key={`${idx}-${project.title}`}
                  project={project}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </SectionFrame>
  )
}
