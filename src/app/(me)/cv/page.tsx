import type { Metadata } from 'next'

import CvPrintButton from '@/components/cv/CvPrintButton'
import CvSheets from '@/components/cv/CvSheets'
import { CV_ROUTE_CSS } from '@/components/cv/cv-sheet-css'
import JsonLd from '@/components/JsonLd'
import { arimo } from '@/lib/cv-font'
import { loadPublicResume } from '@/lib/profile-data'
import { deriveResume } from '@/lib/resume-view-model'
import { resolveSiteOrigin } from '@/lib/seo'
import { personEntityId } from '@/lib/structured-data'

/**
 * The public 2 x A4 CV.
 *
 * This file owns only the *route*: reading the resume, the page metadata, and the chrome
 * that exists because the sheets are the whole document (viewport background, the floating
 * print button, `@page`). The sheets themselves live in `CvSheets`, which the settings
 * editor also renders against unsaved state - see `cv-sheet-css.ts` for why the stylesheet
 * is split the way it is.
 */

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const { resume: stored, avatar } = await loadPublicResume()
  const resume = deriveResume({ resume: stored }, avatar)

  const title = `${resume.name} - CV`
  const description = `${resume.role} - curriculum vitae of ${resume.name}.`

  return {
    title,
    description,
    // Missing before, so `/cv` had no self-referencing canonical. Harmless until something
    // links to it with a tracking parameter, at which point `/cv?ref=x` becomes a separate
    // URL competing with this one.
    alternates: { canonical: '/cv' },
    openGraph: {
      type: 'profile',
      url: '/cv',
      title,
      description,
      siteName: resume.name,
      images: [{ url: '/opengraph-image' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/opengraph-image'] },
  }
}

export default async function CVPage() {
  const { resume: stored, avatar } = await loadPublicResume()
  // An unset `resume.photo` inherits the portfolio avatar, so the printed CV tracks the
  // profile picture until a CV-specific one is uploaded.
  const resume = deriveResume({ resume: stored }, avatar)

  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const personId = personEntityId(origin)

  return (
    <main className={`cv ${arimo.variable}`}>
      {/*
        `ProfilePage` whose `mainEntity` points at the SAME Person `@id` the homepage
        declares, rather than describing a second, unrelated person. Google merges nodes by
        `@id`, so this page becomes another statement about one entity instead of diluting
        it - which is the whole point of doing this across the site rather than per page.

        The page content itself is not repeated here. Structured data that restates the
        visible CV would be duplication with a second copy free to drift; the visible sheets
        are the authoritative version.
      */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ProfilePage',
          '@id': `${origin}/cv`,
          url: `${origin}/cv`,
          name: `${resume.name} - CV`,
          description: `${resume.role} - curriculum vitae of ${resume.name}.`,
          inLanguage: 'en',
          mainEntity: { '@id': personId },
          isPartOf: { '@id': `${origin}/#website` },
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${origin}/` },
            { '@type': 'ListItem', position: 2, name: 'CV', item: `${origin}/cv` },
          ],
        }}
      />

      <CvSheets resume={resume} />

      {/*
        Injected AFTER the sheets on purpose. `CvSheets` emits the sheet stylesheet, and the
        `@media print` rules below override `.cv .sheet` at equal specificity - at equal
        specificity the later rule wins, so moving this above the sheets would silently undo
        the print layout (margins, radius and shadow would come back on paper).
      */}
      <style dangerouslySetInnerHTML={{ __html: CV_ROUTE_CSS }} />

      {/* Prints this page rather than serving a checked-in file, so the download can
          never fall behind an edit. */}
      <CvPrintButton />
    </main>
  )
}
