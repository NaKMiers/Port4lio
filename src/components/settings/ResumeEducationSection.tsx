import React from 'react'

import ListTextarea, {
  linesToText,
  textToLines,
} from '@/components/settings/ListTextarea'
import Section from '@/components/settings/Section'
import { BOLD_HINT } from '@/components/settings/resume-utils'
import {
  helpTextCls,
  inputCls,
  labelCls,
  textareaCls,
} from '@/components/settings/settings-utils'
import type { CvSectionProps } from '@/components/settings/types'

export default function ResumeEducationSection({
  resume,
  setResume,
  handle,
}: CvSectionProps) {
  return (
    <Section
      id="cv-education"
      title="CV Education"
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
              setResume(r => ({
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
              setResume(r => ({
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
