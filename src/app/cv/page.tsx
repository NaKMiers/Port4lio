import type { Metadata } from 'next'

import CvPrintButton from '@/components/cv/CvPrintButton'
import CvSheets from '@/components/cv/CvSheets'
import { CV_ROUTE_CSS } from '@/components/cv/cv-sheet-css'
import { arimo } from '@/lib/cv-font'
import { loadPublicResume } from '@/lib/profile-data'
import { deriveResume } from '@/lib/resume-view-model'

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
  return {
    title: `${resume.name} — CV`,
    description: `${resume.role} — curriculum vitae of ${resume.name}.`,
  }
}

export default async function CVPage() {
  const { resume: stored, avatar } = await loadPublicResume()
  // An unset `resume.photo` inherits the portfolio avatar, so the printed CV tracks the
  // profile picture until a CV-specific one is uploaded.
  const resume = deriveResume({ resume: stored }, avatar)

  return (
    <main className={`cv ${arimo.variable}`}>
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
