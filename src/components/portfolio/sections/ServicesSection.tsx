import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { sanitizeBriefServices, sanitizeServiceItems } from '@/lib/profile-copy'
import type { ServicesViewModel } from '@/lib/profile-view-model'
import type { ServiceItem } from '@/types/profile'
import { resolveIconFromCode } from '@/utils/iconResolver'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

const eyebrowCls =
  'text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'

/** Matches reference HTML accent rhythm; cycles for long lists. */
const ACCENT_DOT_CLASS = [
  'bg-pp-blue',
  'bg-pp-green',
  'bg-pp-violet',
  'bg-pp-pink',
  'bg-pp-orange',
  'bg-pp-text',
] as const

type ServicesSectionProps = {
  services: ServicesViewModel
}

function accentDotClass(i: number): string {
  return ACCENT_DOT_CLASS[i % ACCENT_DOT_CLASS.length] ?? 'bg-pp-blue'
}

function buildServiceStory(briefBullets: string[], items: ServiceItem[]) {
  const leadA = items[0]?.title || briefBullets[0] || 'Product execution'
  const leadB = items[1]?.title || briefBullets[1] || 'Interface systems'
  const detailLines = briefBullets.slice(0, 3)

  return {
    title: `${leadA} + ${leadB}, shaped into one clean delivery flow.`,
    body: detailLines.length
      ? `Signals already in the portfolio data: ${detailLines.join(', ')}. The work is tuned to ship fast, look sharp, and stay maintainable after launch.`
      : 'The services shown here are pulled from the live profile data, then presented as a tighter delivery story instead of a generic card dump.',
  }
}

/**
 * Capability band: structured service cards (when present) plus a fast-scan brief list.
 * Malformed `briefServices` / service rows are normalized via {@link sanitizeBriefServices} /
 * {@link sanitizeServiceItems} (defensive pass - same helpers as the public view model).
 */
export default function ServicesSection({ services }: ServicesSectionProps) {
  const briefBullets = sanitizeBriefServices(services.briefBullets ?? [])
  const items = sanitizeServiceItems(services.items ?? [])
  const story = buildServiceStory(briefBullets, items)

  const heading = services.heading.trim()
  const subheading = services.subheading.trim()
  const displayHeading =
    heading ||
    (items.length || briefBullets.length || subheading ? 'Capabilities' : '')

  const hasIntro = Boolean(displayHeading || subheading)
  const hasBody = items.length > 0 || briefBullets.length > 0

  if (!hasIntro && !hasBody) return null

  return (
    <SectionFrame
      id="services"
      aria-labelledby={displayHeading ? 'services-heading' : undefined}
      aria-label={
        displayHeading ? undefined : 'Services and consulting capabilities'
      }
      className="scroll-mt-24 border-b border-pp-line md:scroll-mt-28"
    >
      <div className="space-y-10 md:space-y-12">
        {hasIntro ? (
          <header className="max-w-3xl space-y-3">
            <p className={eyebrowCls}>Capabilities</p>
            {displayHeading ? (
              <h2
                id="services-heading"
                className="text-pretty font-display text-[clamp(1.65rem,3.6vw,2.35rem)] font-semibold leading-tight tracking-tight text-pp-text"
              >
                {displayHeading}
              </h2>
            ) : null}
            {subheading ? (
              <p className="text-pretty font-editorial text-base leading-[1.75] text-pp-muted md:text-[1.0625rem] md:leading-[1.78]">
                {subheading}
              </p>
            ) : null}
          </header>
        ) : null}

        {items.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
            <EditorialPanel
              variant="strong"
              className="relative overflow-hidden p-5 sm:p-6"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(51,152,255,0.18),transparent_58%),radial-gradient(circle_at_top_right,rgba(255,159,64,0.18),transparent_54%)]" />
              <div className="relative space-y-5">
                <div className="space-y-3">
                  <p className={eyebrowCls}>What clients actually get</p>
                  <h3 className="font-display text-[clamp(1.35rem,2vw,1.7rem)] font-semibold leading-tight tracking-tight text-pp-text">
                    {story.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-pp-muted sm:text-base">
                    {story.body}
                  </p>
                </div>

                {briefBullets.length > 0 ? (
                  <ul
                    className="flex flex-wrap gap-2.5"
                    aria-label="Popular service requests"
                  >
                    {briefBullets.slice(0, 8).map((label, i) => (
                      <li key={`${label}-featured-${i}`}>
                        <span className="bg-white/78 inline-flex items-center gap-2 rounded-full border border-pp-line px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.13em] text-pp-text shadow-[0_10px_26px_rgba(46,35,28,0.05)] backdrop-blur-md">
                          <span
                            className={cx(
                              'h-2 w-2 rounded-full',
                              accentDotClass(i)
                            )}
                            aria-hidden
                          />
                          {label}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </EditorialPanel>

            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
              role="list"
            >
              {items.map((item, i) => {
                const iconNode = item.icon.trim()
                  ? resolveIconFromCode(item.icon, 18, 'text-pp-text')
                  : null
                const titleId = `service-title-${i}`
                const descId = item.description
                  ? `service-desc-${i}`
                  : undefined
                return (
                  <article
                    key={`${item.title}-${i}`}
                    role="listitem"
                    className="h-full min-h-0"
                    aria-labelledby={titleId}
                    {...(descId ? { 'aria-describedby': descId } : {})}
                  >
                    <EditorialPanel
                      variant="default"
                      className="group relative flex h-full flex-col overflow-hidden p-5 motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_24px_48px_rgba(46,35,28,0.1)]"
                    >
                      <div
                        className={cx(
                          'pointer-events-none absolute inset-x-0 top-0 h-1.5',
                          accentDotClass(i)
                        )}
                        aria-hidden
                      />
                      <div className="flex items-start justify-between gap-3">
                        <span className="bg-white/78 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-pp-line shadow-[0_12px_24px_rgba(46,35,28,0.06)] backdrop-blur-md">
                          {iconNode ?? (
                            <span
                              className={cx(
                                'h-3 w-3 rounded-full',
                                accentDotClass(i)
                              )}
                              aria-hidden
                            />
                          )}
                        </span>
                        <span className="rounded-full border border-pp-line bg-pp-panel-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </div>

                      <h3
                        id={titleId}
                        className="mt-4 font-display text-[1.02rem] font-semibold leading-snug text-pp-text sm:text-[1.08rem]"
                      >
                        <span className="min-w-0 text-pretty">
                          {item.title}
                        </span>
                      </h3>
                      {item.description ? (
                        <p
                          id={descId}
                          className="mt-3 text-pretty text-sm leading-relaxed text-pp-muted"
                        >
                          {item.description}
                        </p>
                      ) : null}

                      <div className="mt-auto pt-5">
                        <span className="bg-white/72 inline-flex items-center gap-2 rounded-full border border-pp-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-text">
                          <span
                            className={cx(
                              'h-1.5 w-1.5 rounded-full',
                              accentDotClass(i)
                            )}
                            aria-hidden
                          />
                          Ready to scope
                        </span>
                      </div>
                    </EditorialPanel>
                  </article>
                )
              })}
            </div>
          </div>
        ) : null}

        {items.length > 0 && briefBullets.length > 0 ? (
          <div className="space-y-3">
            <p className={eyebrowCls}>Also ship</p>
            <ul
              className="flex flex-wrap gap-2.5"
              aria-label="Concise service list"
            >
              {briefBullets.map((label, i) => (
                <li key={`${label}-${i}`}>
                  <span className="inline-flex max-w-full items-center rounded-full border border-pp-line bg-pp-panel-strong px-3.5 py-2 font-display text-[11px] font-bold uppercase leading-none tracking-wide text-pp-text">
                    <span
                      className={cx(
                        'mr-2 h-1.5 w-1.5 shrink-0 rounded-full',
                        accentDotClass(i)
                      )}
                      aria-hidden
                    />
                    <span className="break-words">{label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {items.length === 0 && briefBullets.length > 0 ? (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            role="list"
            aria-label="Capability highlights"
          >
            {briefBullets.map((label, i) => (
              <article
                key={`${label}-card-${i}`}
                role="listitem"
                className="min-h-0"
              >
                <EditorialPanel
                  variant="default"
                  className="p-4 sm:p-5"
                >
                  <h3 className="flex items-start gap-2.5 font-display text-sm font-semibold leading-snug text-pp-text">
                    <span
                      className={cx(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        accentDotClass(i)
                      )}
                      aria-hidden
                    />
                    <span className="text-pretty">{label}</span>
                  </h3>
                </EditorialPanel>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </SectionFrame>
  )
}
