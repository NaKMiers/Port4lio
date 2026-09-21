import {
  PortfolioExternalLink,
  ProjectImageCarousel,
  SectionFrame,
} from '@/components/portfolio/primitives'
import {
  collapseWhitespace,
  excerptText,
  projectDetailLines,
  projectOutboundLinks,
  trimText,
} from '@/lib/profile-copy'
import type { ProjectsBandViewModel } from '@/lib/profile-view-model'
import type { ProjectItem, ProjectPart } from '@/types/profile'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

function slidesFromParts(title: string, parts: ProjectPart[]) {
  return parts
    .map((part, index) => ({
      src: trimText(part.image),
      alt: `${title} - preview ${index + 1}`,
      caption: part.description
        ? excerptText(collapseWhitespace(part.description), 92)
        : undefined,
    }))
    .filter(slide => slide.src.length > 0)
}

function CatalogProjectTile({ project }: { project: ProjectItem }) {
  const title = collapseWhitespace(project.title) || 'Project'
  const slides = slidesFromParts(title, project.parts)
  const desc =
    collapseWhitespace(project.overview ?? '') ||
    projectDetailLines(project)[0] ||
    ''
  const excerpt = desc
    ? desc.length > 140
      ? excerptText(desc, 140)
      : desc
    : null
  const links = projectOutboundLinks(project)
  const primary = links[0]

  return (
    <article className="group flex flex-col overflow-hidden rounded-[1.6rem] border border-pp-line bg-pp-panel/60 motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_24px_48px_rgba(46,35,28,0.1)]">
      <div className="relative overflow-hidden bg-pp-panel-strong p-3">
        {slides.length ? (
          <ProjectImageCarousel
            slides={slides}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            aspectClassName="aspect-[4/3]"
            chrome="catalog"
          />
        ) : (
          <div className="flex aspect-[4/3] h-full w-full items-center justify-center rounded-[1.6rem] bg-gradient-to-br from-pp-panel-strong to-pp-bg px-6 text-center">
            <p className="font-display text-sm font-semibold text-pp-muted">
              {title}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-1">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
            Project story
          </p>
          <h3 className="font-display text-base font-semibold leading-snug text-pp-text md:text-lg">
            {title}
          </h3>
        </div>
        {excerpt ? (
          <p className="text-sm leading-relaxed text-pp-muted">{excerpt}</p>
        ) : null}
        {primary ? (
          <div className="mt-auto pt-1">
            <PortfolioExternalLink
              href={primary.url}
              className="inline-flex min-h-[42px] items-center justify-center rounded-full bg-pp-text px-4 py-2 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(17,17,17,0.16)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_20px_36px_rgba(17,17,17,0.2)]"
            >
              {primary.label}
            </PortfolioExternalLink>
          </div>
        ) : null}
      </div>
    </article>
  )
}

type ProjectCatalogSectionProps = {
  catalog: ProjectsBandViewModel
}

export default function ProjectCatalogSection({
  catalog,
}: ProjectCatalogSectionProps) {
  if (!catalog.projects.length) return null

  const archiveLine =
    catalog.subheading.trim() ||
    `${catalog.projects.length} additional project${catalog.projects.length > 1 ? 's' : ''} pulled from the same live portfolio record.`

  return (
    <SectionFrame
      id="catalog"
      aria-labelledby="catalog-heading"
      className="scroll-mt-24 border-b border-pp-line md:scroll-mt-28"
    >
      <div className="mb-8 max-w-2xl space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
          Archive
        </p>
        <h2
          id="catalog-heading"
          className="font-display text-[clamp(1.35rem,2.8vw,1.75rem)] font-semibold tracking-tight text-pp-text"
        >
          More shipped stories
        </h2>
        <p className="font-display text-base font-medium leading-relaxed text-pp-muted">
          {archiveLine}
        </p>
      </div>

      <div className={cx('grid gap-4 sm:grid-cols-2 lg:grid-cols-3')}>
        {catalog.projects.map((project, index) => (
          <CatalogProjectTile
            key={`catalog-${index}-${collapseWhitespace(project.title).slice(0, 32)}`}
            project={project}
          />
        ))}
      </div>
    </SectionFrame>
  )
}
