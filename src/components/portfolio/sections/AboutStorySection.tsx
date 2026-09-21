import AboutTimelineTabs from '@/components/portfolio/AboutTimelineTabs'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { sortEducationRecent, sortExperienceRecent } from '@/lib/profile-copy'
import type { AboutViewModel } from '@/lib/profile-view-model'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type AboutStorySectionProps = {
  about: AboutViewModel
}

const eyebrowCls =
  'text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'

/** Editorial story + modular resume context, now with richer narrative panels and proof chips. */
export default function AboutStorySection({ about }: AboutStorySectionProps) {
  const {
    heading,
    subheading,
    paragraphs,
    skills,
    experience,
    education,
    certificates,
  } = about

  const experienceSorted = sortExperienceRecent(experience)
  const educationSorted = sortEducationRecent(education)
  const hasTimelineTabs =
    experienceSorted.length > 0 ||
    educationSorted.length > 0 ||
    certificates.length > 0

  const hasAside = skills.length > 0 || hasTimelineTabs
  const hasHeading = Boolean(heading)
  const storyLead = paragraphs[0] ?? ''
  const storyTail = paragraphs.slice(1)
  const proofFacts = [
    experienceSorted.length
      ? `${experienceSorted.length} experience chapters`
      : '',
    educationSorted.length
      ? `${educationSorted.length} education milestone${educationSorted.length > 1 ? 's' : ''}`
      : '',
    certificates.length
      ? `${certificates.length} credential${certificates.length > 1 ? 's' : ''}`
      : '',
    skills.length
      ? `${skills.length} skill group${skills.length > 1 ? 's' : ''}`
      : '',
  ].filter(Boolean)

  if (!hasHeading && paragraphs.length === 0 && !subheading && !hasAside)
    return null

  return (
    <SectionFrame
      id="about"
      aria-labelledby="about-heading"
      className="scroll-mt-24 border-b border-pp-line md:scroll-mt-28"
    >
      <div
        className={cx(
          'grid gap-12 lg:gap-14',
          hasAside ? 'lg:grid-cols-2 lg:items-start' : ''
        )}
      >
        <div className="min-w-0 space-y-6 lg:space-y-7">
          {hasHeading ? (
            <header className="space-y-3">
              <p className={eyebrowCls}>Background</p>
              <h2
                id="about-heading"
                className="text-pretty font-display text-[clamp(1.75rem,3.8vw,2.5rem)] font-semibold leading-tight tracking-tight text-pp-text"
              >
                {heading}
              </h2>
              {subheading ? (
                <p className="max-w-prose font-display text-lg font-medium leading-snug text-pp-muted md:text-xl">
                  {subheading}
                </p>
              ) : null}
            </header>
          ) : null}

          {storyLead ? (
            <EditorialPanel
              variant="strong"
              className="relative overflow-hidden px-5 py-6 sm:px-6 sm:py-7"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,159,64,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(51,152,255,0.14),transparent_34%)]" />
              <div className="relative space-y-4">
                <p className="font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted">
                  Story signal
                </p>
                <p className="text-pretty font-display text-[clamp(1.18rem,2.2vw,1.5rem)] font-medium leading-[1.55] text-pp-text">
                  {storyLead}
                </p>
                {proofFacts.length ? (
                  <ul className="flex flex-wrap gap-2.5 pt-1">
                    {proofFacts.map((fact, index) => (
                      <li key={`${fact}-${index}`}>
                        <span className="bg-white/78 inline-flex items-center rounded-full border border-pp-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-text shadow-[0_10px_20px_rgba(46,35,28,0.05)]">
                          {fact}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </EditorialPanel>
          ) : null}

          {storyTail.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {storyTail.map((p, i) => (
                <EditorialPanel
                  key={i}
                  className="h-full p-5 sm:p-6"
                >
                  <p className="text-pretty text-base leading-[1.78] text-pp-muted md:text-[1.0625rem] md:leading-[1.8]">
                    {p}
                  </p>
                </EditorialPanel>
              ))}
            </div>
          ) : null}
        </div>

        {hasAside ? (
          <aside
            className="min-w-0 space-y-6"
            aria-label="Skills, experience, and education"
          >
            {skills.length > 0 ? (
              <div className="space-y-4">
                <p className={cx(eyebrowCls, 'lg:mt-1')}>Capability map</p>
                <div className="space-y-3">
                  {skills.map((group, gi) => (
                    <EditorialPanel
                      key={`${group.groupName || 'group'}-${gi}`}
                      className="p-4 sm:p-5"
                    >
                      <p className={eyebrowCls}>
                        {group.groupName || 'Skills'}
                      </p>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {group.items.map((item, ii) => (
                          <li key={`${item.name}-${ii}`}>
                            <span className="inline-flex max-w-full break-words rounded-full border border-pp-line bg-pp-panel-strong px-3.5 py-1.5 text-sm font-medium leading-snug text-pp-text shadow-[0_10px_20px_rgba(46,35,28,0.04)]">
                              {item.name}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </EditorialPanel>
                  ))}
                </div>
              </div>
            ) : null}

            {hasTimelineTabs ? (
              <AboutTimelineTabs
                experience={experienceSorted}
                education={educationSorted}
                certificates={certificates}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </SectionFrame>
  )
}
