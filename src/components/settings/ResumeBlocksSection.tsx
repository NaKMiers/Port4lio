import React from 'react'

import Section from '@/components/settings/Section'
import {
  emptyStateCls,
  ghostBtnCls,
  helpTextCls,
  inputCls,
  itemCardCls,
  labelCls,
  nestedItemCardCls,
  secondaryBtnCls,
  textareaCls,
} from '@/components/settings/settings-utils'
import {
  BOLD_HINT,
  linesToText,
  replaceAt,
  resumeOf,
  textToLines,
  updateResume,
} from '@/components/settings/resume-utils'
import type { Certificate, Profile, ResumeCertificationGroup } from '@/types/profile'

export default function ResumeBlocksSection({
  profile,
  setProfile,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
}) {
  const resume = resumeOf(profile)

  const updateGroup = (idx: number, patch: Partial<ResumeCertificationGroup>) => {
    updateResume(setProfile, r => ({
      ...r,
      certifications: { ...r.certifications, groups: replaceAt(r.certifications.groups, idx, patch) },
    }))
  }

  const updateCert = (groupIdx: number, certIdx: number, patch: Partial<Certificate>) => {
    updateResume(setProfile, r => {
      const group = r.certifications.groups[groupIdx]
      return {
        ...r,
        certifications: {
          ...r.certifications,
          groups: replaceAt(r.certifications.groups, groupIdx, {
            items: replaceAt(group.items, certIdx, patch),
          }),
        },
      }
    })
  }

  return (
    <Section title='CV Summary & Certifications' badge='**bold** supported'>
      <div className='space-y-4'>
        <p className={helpTextCls}>{BOLD_HINT} One printed line per row.</p>

        <div className={itemCardCls}>
          <div className='space-y-2'>
            <label className={labelCls}>Summary heading</label>
            <input
              className={inputCls}
              value={resume.summary.heading}
              onChange={e =>
                updateResume(setProfile, r => ({
                  ...r,
                  summary: { ...r.summary, heading: e.target.value },
                }))
              }
            />
          </div>
          <div className='mt-3 space-y-2'>
            <label className={labelCls}>Summary lines</label>
            <textarea
              className={textareaCls}
              rows={6}
              value={linesToText(resume.summary.lines)}
              onChange={e =>
                updateResume(setProfile, r => ({
                  ...r,
                  summary: { ...r.summary, lines: textToLines(e.target.value) },
                }))
              }
            />
          </div>
        </div>

        <div className={itemCardCls}>
          <div className='space-y-2'>
            <label className={labelCls}>Education heading</label>
            <input
              className={inputCls}
              value={resume.education.heading}
              onChange={e =>
                updateResume(setProfile, r => ({
                  ...r,
                  education: { ...r.education, heading: e.target.value },
                }))
              }
            />
          </div>
          <div className='mt-3 space-y-2'>
            <label className={labelCls}>Education lines</label>
            <textarea
              className={textareaCls}
              rows={3}
              value={linesToText(resume.education.lines)}
              onChange={e =>
                updateResume(setProfile, r => ({
                  ...r,
                  education: { ...r.education, lines: textToLines(e.target.value) },
                }))
              }
            />
          </div>
        </div>

        <div className='space-y-2'>
          <label className={labelCls}>Certifications heading</label>
          <input
            className={inputCls}
            value={resume.certifications.heading}
            onChange={e =>
              updateResume(setProfile, r => ({
                ...r,
                certifications: { ...r.certifications, heading: e.target.value },
              }))
            }
          />
        </div>

        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>Certification groups</h2>
          <button
            type='button'
            className={secondaryBtnCls}
            onClick={() =>
              updateResume(setProfile, r => ({
                ...r,
                certifications: {
                  ...r.certifications,
                  groups: [...r.certifications.groups, { issuer: '', items: [] }],
                },
              }))
            }
          >
            + Add group
          </button>
        </div>

        {resume.certifications.groups.length === 0 ? (
          <div className={emptyStateCls}>No certification groups yet.</div>
        ) : null}

        {resume.certifications.groups.map((group, groupIdx) => (
          <div key={groupIdx} className={itemCardCls}>
            <div className='space-y-2'>
              <label className={labelCls}>Issuer</label>
              <input
                className={inputCls}
                placeholder='Anthropic, 2026'
                value={group.issuer}
                onChange={e => updateGroup(groupIdx, { issuer: e.target.value })}
              />
            </div>

            <div className='mt-4 space-y-3'>
              {group.items.map((cert, certIdx) => (
                <div key={certIdx} className={nestedItemCardCls}>
                  <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                    <div className='space-y-2'>
                      <label className={labelCls}>Name</label>
                      <input
                        className={inputCls}
                        value={cert.name}
                        onChange={e => updateCert(groupIdx, certIdx, { name: e.target.value })}
                      />
                    </div>
                    <div className='space-y-2'>
                      <label className={labelCls}>Link</label>
                      <input
                        className={inputCls}
                        value={cert.link}
                        onChange={e => updateCert(groupIdx, certIdx, { link: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className='mt-3 flex justify-end'>
                    <button
                      type='button'
                      className={ghostBtnCls}
                      onClick={() =>
                        updateGroup(groupIdx, {
                          items: group.items.filter((_, i) => i !== certIdx),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className='mt-3 flex justify-between'>
              <button
                type='button'
                className={secondaryBtnCls}
                onClick={() => updateGroup(groupIdx, { items: [...group.items, { name: '', link: '' }] })}
              >
                + Add certificate
              </button>
              <button
                type='button'
                className={ghostBtnCls}
                onClick={() =>
                  updateResume(setProfile, r => ({
                    ...r,
                    certifications: {
                      ...r.certifications,
                      groups: r.certifications.groups.filter((_, i) => i !== groupIdx),
                    },
                  }))
                }
              >
                Remove group
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
