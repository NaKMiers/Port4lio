import React from 'react'

import ListTextarea, {
  linesToText,
  textToLines,
} from '@/components/settings/ListTextarea'
import Section from '@/components/settings/Section'
import {
  BOLD_HINT,
  resumeOf,
  updateResume,
} from '@/components/settings/resume-utils'
import {
  helpTextCls,
  inputCls,
  labelCls,
  textareaCls,
} from '@/components/settings/settings-utils'
import type { CvSectionProps } from '@/components/settings/types'

export default function ResumeEducationSection({
  profile,
  setProfile,
  handle,
}: CvSectionProps) {
  const resume = resumeOf(profile)

  return (
    <Section
      id="cv-education"
      title="CV Education"
      badge="**bold** supported"
      handle={handle}
    >
      <div className="space-y-4">
        <p className={helpTextCls}>
          {BOLD_HINT} One printed line per row. This is the CV block only - the
          portfolio&apos;s own education timeline lives on the Career tab.
        </p>

        <div className="space-y-2">
          <label className={labelCls}>Heading</label>
          <input
            className={inputCls}
            placeholder="EDUCATION"
            value={resume.education.heading}
            onChange={e =>
              updateResume(setProfile, r => ({
                ...r,
                education: { ...r.education, heading: e.target.value },
              }))
            }
          />
        </div>

        <div className="space-y-2">
          <label className={labelCls}>Lines</label>
          <ListTextarea
            className={textareaCls}
            rows={3}
            value={resume.education.lines}
            join={linesToText}
            parse={textToLines}
            onChange={lines =>
              updateResume(setProfile, r => ({
                ...r,
                education: { ...r.education, lines },
              }))
            }
          />
        </div>
      </div>
    </Section>
  )
}
