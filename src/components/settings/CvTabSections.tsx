'use client'

import React, { useEffect } from 'react'

import DragList from '@/components/settings/DragList'
import ResumeCertificationsSection from '@/components/settings/ResumeCertificationsSection'
import ResumeEducationSection from '@/components/settings/ResumeEducationSection'
import ResumeMastheadSection from '@/components/settings/ResumeMastheadSection'
import ResumeProjectsSection from '@/components/settings/ResumeProjectsSection'
import ResumeSkillsSection from '@/components/settings/ResumeSkillsSection'
import ResumeSummarySection from '@/components/settings/ResumeSummarySection'
import { useCvPageBreakFit } from '@/components/settings/useCvPageBreakFit'
import { helpTextCls } from '@/components/settings/settings-utils'
import type {
  CvSectionProps,
  UploadingState,
} from '@/components/settings/types'
import { moveItem, normalizeResumeSectionOrder } from '@/lib/resume-sections'
import type { Resume, ResumePageBreak, ResumeSectionKey } from '@/types/profile'

const SECTION_COMPONENTS: Record<
  ResumeSectionKey,
  React.ComponentType<CvSectionProps>
> = {
  summary: ResumeSummarySection,
  education: ResumeEducationSection,
  skills: ResumeSkillsSection,
  certifications: ResumeCertificationsSection,
  projects: ResumeProjectsSection,
}

/**
 * The CV tab's editor column.
 *
 * Card order here IS the print order: each card is keyed by a {@link ResumeSectionKey} and
 * the list is driven by `resume.sectionOrder`, which `CvSheets` walks to lay out the sheets.
 * So a drag moves the block on the printed page, not just the panel in the editor.
 *
 * The masthead sits outside the list on purpose - it is the page header, positioned against
 * the sheet's own top edge rather than in normal flow, so there is no "below SUMMARY" for it
 * to move to.
 *
 * Every card edits `resume`, the draft of the CV the picker selected. The draft itself lives
 * in `useCvEditor` up in `SettingEditor`, because this component unmounts on every tab switch
 * and the draft must not go with it (multi-cv-plan.md OV-4).
 */
export default function CvTabSections({
  cvId,
  resume,
  setResume,
  avatar,
  onClippedRefit,
  uploading,
  setUploading,
  setError,
}: {
  /** The selected CV. A new one re-runs the on-open fit, as a fresh mount would. */
  cvId: string
  resume: Resume
  setResume: React.Dispatch<React.SetStateAction<Resume>>
  avatar: string
  /** The on-open fit moved the break; see `useCvPageBreakFit`. */
  onClippedRefit: (next: ResumePageBreak) => void
  uploading: UploadingState
  setUploading: React.Dispatch<React.SetStateAction<UploadingState>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const order = normalizeResumeSectionOrder(resume.sectionOrder)
  const { requestFit, portal } = useCvPageBreakFit(resume, avatar, setResume, {
    onClippedRefit,
  })

  // A break stored before a reorder - or by a build that predates the fitter - can render a
  // clipped sheet on open, and nothing else would ever re-measure it. Repairs only an
  // overflowing page, so a break that already fits is left exactly where its owner put it.
  // Keyed on the CV too: picking another CV in the dropdown is an "open" for that CV.
  useEffect(() => {
    requestFit({ onlyIfClipped: true })
  }, [requestFit, cvId])

  const moveSection = (from: number, to: number) => {
    setResume(r => ({
      ...r,
      sectionOrder: moveItem(
        normalizeResumeSectionOrder(r.sectionOrder),
        from,
        to
      ),
    }))
    requestFit()
  }

  return (
    <div className="space-y-5">
      <ResumeMastheadSection
        resume={resume}
        setResume={setResume}
        avatar={avatar}
        uploading={uploading}
        setUploading={setUploading}
        setError={setError}
      />

      <p className={`${helpTextCls} px-1`}>
        Drag a grip (or use arrow keys) to reorder. The masthead always prints
        first; the page break re-fits itself.
      </p>

      <DragList
        ids={order}
        onReorder={moveSection}
        itemLabel="CV section"
        className="space-y-5"
      >
        {(index, handle) => {
          const SectionComponent = SECTION_COMPONENTS[order[index]]
          return (
            <SectionComponent
              resume={resume}
              setResume={setResume}
              avatar={avatar}
              handle={handle}
              onFitPageBreak={requestFit}
            />
          )
        }}
      </DragList>

      {portal}
    </div>
  )
}
