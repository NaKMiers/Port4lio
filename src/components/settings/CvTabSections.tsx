'use client'

import React, { useEffect } from 'react'

import DragList from '@/components/settings/DragList'
import ResumeCertificationsSection from '@/components/settings/ResumeCertificationsSection'
import ResumeEducationSection from '@/components/settings/ResumeEducationSection'
import ResumeMastheadSection from '@/components/settings/ResumeMastheadSection'
import ResumeProjectsSection from '@/components/settings/ResumeProjectsSection'
import ResumeSkillsSection from '@/components/settings/ResumeSkillsSection'
import ResumeSummarySection from '@/components/settings/ResumeSummarySection'
import { resumeOf, updateResume } from '@/components/settings/resume-utils'
import { useCvPageBreakFit } from '@/components/settings/useCvPageBreakFit'
import { helpTextCls } from '@/components/settings/settings-utils'
import type { CvSectionProps, UploadingState } from '@/components/settings/types'
import { moveItem, normalizeResumeSectionOrder } from '@/lib/resume-sections'
import type { Profile, ResumeSectionKey } from '@/types/profile'

const SECTION_COMPONENTS: Record<ResumeSectionKey, React.ComponentType<CvSectionProps>> = {
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
 */
export default function CvTabSections({
  profile,
  setProfile,
  uploading,
  setUploading,
  setError,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  uploading: UploadingState
  setUploading: React.Dispatch<React.SetStateAction<UploadingState>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const order = normalizeResumeSectionOrder(resumeOf(profile).sectionOrder)
  const { requestFit, portal } = useCvPageBreakFit(profile, setProfile)

  // A break stored before a reorder - or by a build that predates the fitter - can render a
  // clipped sheet on open, and nothing else would ever re-measure it. Repairs only an
  // overflowing page, so a break that already fits is left exactly where its owner put it.
  useEffect(() => {
    requestFit({ onlyIfClipped: true })
  }, [requestFit])

  const moveSection = (from: number, to: number) => {
    updateResume(setProfile, r => ({
      ...r,
      sectionOrder: moveItem(normalizeResumeSectionOrder(r.sectionOrder), from, to),
    }))
    requestFit()
  }

  return (
    <div className='space-y-5'>
      <ResumeMastheadSection
        profile={profile}
        setProfile={setProfile}
        uploading={uploading}
        setUploading={setUploading}
        setError={setError}
      />

      <p className={`${helpTextCls} px-1`}>
        Drag a card by its grip to change the order these blocks print in on{' '}
        <strong>/cv</strong> — the preview follows immediately. Arrow keys work too once the grip
        has focus. The masthead above is the page header and always prints first. Every reorder
        re-measures the sheets and moves the page break to wherever sheet 1 now ends.
      </p>

      <DragList ids={order} onReorder={moveSection} itemLabel='CV section' className='space-y-5'>
        {(index, handle) => {
          const SectionComponent = SECTION_COMPONENTS[order[index]]
          return (
            <SectionComponent
              profile={profile}
              setProfile={setProfile}
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
