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

export default function ResumeSummarySection({
  resume,
  setResume,
  handle,
}: CvSectionProps) {
  return (
    <Section
      id="cv-summary"
      title="CV Summary"
      handle={handle}
    >
      <div className="space-y-4">
        <p className={helpTextCls}>{BOLD_HINT} One printed line per row.</p>

        <div className="space-y-2">
          <label className={labelCls}>Heading</label>
          <input
            className={inputCls}
            placeholder="SUMMARY"
            value={resume.summary.heading}
            onChange={e =>
              setResume(r => ({
                ...r,
                summary: { ...r.summary, heading: e.target.value },
              }))
            }
          />
        </div>

        <div className="space-y-2">
          <label className={labelCls}>Lines</label>
          <ListTextarea
            className={textareaCls}
            rows={6}
            value={resume.summary.lines}
            join={linesToText}
            parse={textToLines}
            onChange={lines =>
              setResume(r => ({
                ...r,
                summary: { ...r.summary, lines },
              }))
            }
          />
        </div>
      </div>
    </Section>
  )
}
