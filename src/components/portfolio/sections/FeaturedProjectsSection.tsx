import {
  PortfolioExternalLink,
  ProjectStoryCard,
  ProjectStoryMedia,
  SectionFrame,
} from '@/components/portfolio/primitives'
import {
  PROJECT_TECH_LIMIT,
  collapseWhitespace,
  projectOutboundLinks,
} from '@/lib/profile-copy'
import type { ProjectsBandViewModel } from '@/lib/profile-view-model'
import type { ProjectItem } from '@/types/profile'

function FeaturedProjectArticle({
  project,
  index,
}: {
  project: ProjectItem
  /** Display index (deterministic array order). */
  index: number
}) {
  const title = collapseWhitespace(project.title) || 'Project'
  const overview = collapseWhitespace(project.overview ?? '')
  const tech = (project.techStack ?? []).slice(0, PROJECT_TECH_LIMIT)
  const ctas = projectOutboundLinks(project)

  return (
    <article className="h-full">
      <ProjectStoryCard
        className="h-full"
        meta={`Featured work · ${String(index + 1).padStart(2, '0')}`}
        title={title}
        visual={
          <ProjectStoryMedia
            projectTitle={title}
            parts={project.parts}
            priority={index === 0}
          />
        }
      >
        <div className="flex h-full flex-col gap-4">
          {overview ? (
            <div className="bg-white/72 rounded-[1.2rem] border border-pp-line/80 px-4 py-3 shadow-[0_10px_24px_rgba(46,35,28,0.05)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
                Overview
              </p>
              <p className="mt-1 text-sm leading-relaxed text-pp-text">
                {overview}
              </p>
            </div>
          ) : null}
          {tech.length ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
                Tech stack
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {tech.map(item => (
                  <li
                    key={item}
                    className="rounded-full border border-pp-line bg-white/70 px-2.5 py-1 text-xs font-medium text-pp-text"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {ctas.length ? (
            <div className="mt-auto flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
              {ctas.map(({ url, label }) => (
                <PortfolioExternalLink
                  key={url}
                  href={url}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-pp-text px-5 py-2.5 text-center text-sm font-semibold text-white shadow-[0_14px_32px_rgba(17,17,17,0.16)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_20px_36px_rgba(17,17,17,0.2)]"
                >
                  {label}
                </PortfolioExternalLink>
              ))}
            </div>
          ) : null}
        </div>
      </ProjectStoryCard>
    </article>
  )
}

type FeaturedProjectsSectionProps = {
  /** Derived band - project order matches sanitized DB order. */
  featured: ProjectsBandViewModel
}

export default function FeaturedProjectsSection({
  featured,
}: FeaturedProjectsSectionProps) {
  const heading = featured.heading || 'Selected work'
  const sub = featured.subheading

  return (
    <SectionFrame
      id="work"
      aria-labelledby="work-heading"
      className="scroll-mt-24 border-b border-pp-line md:scroll-mt-28"
    >
      <div className="mb-10 max-w-2xl space-y-3">
        <h2
          id="work-heading"
          className="font-display text-[clamp(1.75rem,3.5vw,2.25rem)] font-semibold tracking-tight text-pp-text"
        >
          {heading}
        </h2>
        {sub ? (
          <p className="font-display text-base font-medium leading-relaxed text-pp-muted md:text-lg">
            {sub}
          </p>
        ) : null}
      </div>

      {featured.projects.length ? (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          {featured.projects.map((project, index) => (
            <FeaturedProjectArticle
              key={`featured-story-${index}`}
              project={project}
              index={index}
            />
          ))}
        </div>
      ) : null}
    </SectionFrame>
  )
}
