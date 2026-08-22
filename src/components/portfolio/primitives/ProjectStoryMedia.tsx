import type { ProjectPart } from '@/types/profile'

import { ProjectImageCarousel, type ProjectCarouselSlide } from './ProjectImageCarousel'

export type ProjectStoryMediaProps = {
  projectTitle: string
  parts: ProjectPart[]
  /** First project's first paint */
  priority?: boolean
}

function slidesFromParts(projectTitle: string, parts: ProjectPart[]): ProjectCarouselSlide[] {
  const baseTitle = projectTitle.trim() || 'Project'

  return parts
    .map((part, index) => ({
      src: part.image.trim(),
      alt: `${baseTitle} - preview ${index + 1}`,
      caption: part.description.trim() || undefined,
    }))
    .filter(slide => slide.src.length > 0)
}

/**
 * Auto-sliding project media with optional per-image captions.
 * Featured work now uses a true carousel instead of a static strip so multi-image projects read clearly.
 */
export function ProjectStoryMedia({ projectTitle, parts, priority }: ProjectStoryMediaProps) {
  const slides = slidesFromParts(projectTitle, parts)

  if (!slides.length) {
    // Keep the media block's aspect ratio so cards stay aligned in the two-up grid.
    return (
      <div className='bg-pp-panel-strong p-3 sm:p-4'>
        <div className='flex aspect-[16/10] w-full items-center justify-center rounded-[1.6rem] border border-pp-line/80 bg-gradient-to-br from-pp-panel-strong to-pp-bg px-6 text-center'>
          <p className='text-sm font-medium text-pp-muted'>Preview not published.</p>
        </div>
      </div>
    )
  }

  return (
    <div className='border-b border-pp-line bg-pp-bg/25 p-3 sm:p-4'>
      <ProjectImageCarousel
        slides={slides}
        priority={priority}
        sizes='(max-width: 640px) 100vw, (max-width: 1024px) 88vw, 620px'
        aspectClassName='aspect-[16/10]'
        chrome='feature'
      />
    </div>
  )
}
