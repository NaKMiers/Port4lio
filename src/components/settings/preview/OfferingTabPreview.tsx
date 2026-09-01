import React from 'react'

import {
  Chip,
  CutoffNote,
  EmptyHint,
  PreviewBlock,
  PreviewCard,
  dropNote,
  limitNote,
  previewEyebrowCls,
} from '@/components/settings/preview/preview-primitives'
import {
  FEATURED_PROJECT_LIMIT,
  PROJECT_TECH_LIMIT,
  excerptText,
  labelOutboundHttpsUrl,
  projectDetailLines,
  projectOutboundLinks,
} from '@/lib/profile-copy'
import type { PublicPortfolioViewModel } from '@/lib/profile-view-model'
import type { ProjectItem, Profile } from '@/types/profile'
import { resolveIconFromCode } from '@/utils/iconResolver'

/** The public services panel caps the highlighted bullet list. */
const SERVICE_BULLET_LIMIT = 8
/** Catalog tiles cut their excerpt at this many characters. */
const CATALOG_EXCERPT_CHARS = 140

/**
 * What the Offering tab publishes: the services panel, then the two project bands.
 *
 * The split is the thing worth seeing. Only the first {@link FEATURED_PROJECT_LIMIT} projects
 * get the big treatment with an overview card and tech chips; everything after that drops
 * into a plainer archive grid with a 140-character excerpt and no tech chips at all. The form
 * gives no hint that a fifth project renders differently from the fourth.
 */
export default function OfferingTabPreview({
  profile,
  viewModel,
}: {
  profile: Profile
  viewModel: PublicPortfolioViewModel
}) {
  const { services, featuredProjects, projectCatalog } = viewModel
  const bulletNote = limitNote(
    services.briefBullets.length,
    SERVICE_BULLET_LIMIT,
    'the highlight panel prints the first 8'
  )
  // Matches the public fallback: a heading appears even when the field is blank.
  const heading =
    services.heading || (services.items.length || services.briefBullets.length ? 'Capabilities' : '')

  return (
    <div className='space-y-5'>
      <PreviewBlock title='Services' count={services.items.length}>
        {heading ? (
          <div className='font-display text-base font-semibold leading-snug tracking-tight text-pp-text'>
            {heading}
          </div>
        ) : null}
        {services.subheading ? (
          <p className='text-[12px] leading-relaxed text-pp-muted'>{services.subheading}</p>
        ) : null}
        {!services.heading && heading ? (
          <CutoffNote>No service heading set, so the section prints “Capabilities”.</CutoffNote>
        ) : null}

        {services.briefBullets.length > 0 ? (
          <div className='flex flex-wrap gap-1.5 pt-1'>
            {services.briefBullets.slice(0, SERVICE_BULLET_LIMIT).map((bullet, index) => (
              <Chip key={index}>{bullet}</Chip>
            ))}
          </div>
        ) : null}
        {bulletNote ? (
          <CutoffNote>{bulletNote}. All of them print again in the “Also ship” band.</CutoffNote>
        ) : null}

        {services.items.length === 0 ? (
          services.briefBullets.length === 0 ? (
            <EmptyHint>No services or bullets — the whole capabilities section is hidden.</EmptyHint>
          ) : (
            <CutoffNote>
              No service cards, so the bullets above render as the section&apos;s own cards instead.
            </CutoffNote>
          )
        ) : (
          <div className='space-y-2'>
            {services.items.map((item, index) => (
              <PreviewCard key={index}>
                <div className='flex items-start gap-2.5'>
                  <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.7rem] border border-pp-line bg-white/86 text-pp-text'>
                    {resolveIconFromCode(item.icon, 15)}
                  </span>
                  <div className='min-w-0'>
                    <p className='text-[13px] font-semibold leading-snug text-pp-text'>
                      {item.title || `Service ${index + 1}`}
                    </p>
                    {item.description ? (
                      <p className='mt-0.5 text-[11px] leading-relaxed text-pp-muted'>
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              </PreviewCard>
            ))}
          </div>
        )}
        {dropNote(profile.services.length, services.items.length, 'a title or a description') ? (
          <CutoffNote>
            {dropNote(profile.services.length, services.items.length, 'a title or a description')}
          </CutoffNote>
        ) : null}
      </PreviewBlock>

      <PreviewBlock title='Featured work' count={featuredProjects.projects.length}>
        {featuredProjects.heading ? (
          <div className='font-display text-base font-semibold leading-snug tracking-tight text-pp-text'>
            {featuredProjects.heading}
          </div>
        ) : (
          <CutoffNote>No work heading set, so the section prints “Selected work”.</CutoffNote>
        )}
        {featuredProjects.projects.length === 0 ? (
          <EmptyHint>No renderable projects — the featured band is hidden.</EmptyHint>
        ) : (
          <div className='space-y-2'>
            {featuredProjects.projects.map((project, index) => (
              <FeaturedProjectCard key={index} project={project} index={index} />
            ))}
          </div>
        )}
      </PreviewBlock>

      {projectCatalog.projects.length > 0 ? (
        <PreviewBlock title='Archive' count={projectCatalog.projects.length}>
          <CutoffNote>
            Projects {FEATURED_PROJECT_LIMIT + 1}+ render in a separate “More shipped stories”
            grid: no tech chips, one CTA, and the overview cut to {CATALOG_EXCERPT_CHARS}{' '}
            characters.
          </CutoffNote>
          <div className='space-y-2'>
            {projectCatalog.projects.map((project, index) => (
              <CatalogProjectTile key={index} project={project} />
            ))}
          </div>
        </PreviewBlock>
      ) : null}

      {dropNote(profile.projects.length, featuredProjects.projects.length + projectCatalog.projects.length, 'a title, an overview, or a part with an image, description or link') ? (
        <CutoffNote>
          {dropNote(
            profile.projects.length,
            featuredProjects.projects.length + projectCatalog.projects.length,
            'a title, an overview, or a part with an image, description or link'
          )}
        </CutoffNote>
      ) : null}
    </div>
  )
}

function FeaturedProjectCard({ project, index }: { project: ProjectItem; index: number }) {
  const tech = (project.techStack ?? []).slice(0, PROJECT_TECH_LIMIT)
  const links = projectOutboundLinks(project)
  const thumb = (project.parts ?? []).find(part => part.image)?.image

  return (
    <PreviewCard>
      <div className='flex items-start gap-2.5'>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=''
            className='h-12 w-16 shrink-0 rounded-[0.6rem] border border-pp-line object-cover'
          />
        ) : (
          <div className='flex h-12 w-16 shrink-0 items-center justify-center rounded-[0.6rem] border border-dashed border-pp-line bg-white/50 text-[9px] font-medium text-pp-muted'>
            No image
          </div>
        )}
        <div className='min-w-0 flex-1'>
          <p className={previewEyebrowCls}>Featured · {String(index + 1).padStart(2, '0')}</p>
          <p className='mt-0.5 text-[13px] font-semibold leading-snug text-pp-text'>
            {project.title || 'Project'}
          </p>
          {project.overview ? (
            <p className='mt-1 text-[11px] leading-relaxed text-pp-muted'>{project.overview}</p>
          ) : (
            <p className='mt-1 text-[11px] italic text-pp-muted'>
              No overview — the Overview card is skipped.
            </p>
          )}
        </div>
      </div>

      {tech.length > 0 ? (
        <div className='mt-2 flex flex-wrap gap-1'>
          {tech.map((item, techIndex) => (
            <span
              key={techIndex}
              className='rounded-full border border-pp-line bg-white/70 px-2 py-0.5 text-[10px] font-medium text-pp-text'
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {(project.techStack ?? []).length > PROJECT_TECH_LIMIT ? (
        <p className='mt-1.5 text-[10px] text-pp-muted'>
          {PROJECT_TECH_LIMIT} of {(project.techStack ?? []).length} tech chips print.
        </p>
      ) : null}

      {links.length > 0 ? (
        <div className='mt-2 flex flex-wrap gap-1'>
          {links.map(link => (
            <span
              key={link.url}
              className='rounded-full bg-pp-text px-2 py-0.5 text-[10px] font-semibold text-white'
            >
              {link.label}
            </span>
          ))}
        </div>
      ) : null}
    </PreviewCard>
  )
}

function CatalogProjectTile({ project }: { project: ProjectItem }) {
  const body = project.overview || projectDetailLines(project)[0] || ''
  const excerpt = body.length > CATALOG_EXCERPT_CHARS ? excerptText(body, CATALOG_EXCERPT_CHARS) : body
  const primary = projectOutboundLinks(project)[0]

  return (
    <PreviewCard className='bg-white/58'>
      <p className={previewEyebrowCls}>Project story</p>
      <p className='mt-0.5 text-[12px] font-semibold leading-snug text-pp-text'>
        {project.title || 'Project'}
      </p>
      {excerpt ? (
        <p className='mt-1 text-[11px] leading-relaxed text-pp-muted'>{excerpt}</p>
      ) : null}
      {primary ? (
        <p className='mt-1.5 text-[10px] font-semibold text-pp-muted'>
          CTA: {labelOutboundHttpsUrl(primary.url)}
        </p>
      ) : null}
    </PreviewCard>
  )
}
