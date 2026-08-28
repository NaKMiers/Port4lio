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
import { replaceAt, resumeOf, updateResume } from '@/components/settings/resume-utils'
import type { Profile } from '@/types/profile'

/** Rows are comma or newline separated, matching how techStack is edited elsewhere. */
const parseRow = (text: string) =>
  text
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean)

export default function ResumeSkillsSection({
  profile,
  setProfile,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
}) {
  const resume = resumeOf(profile)

  const updateRow = (blockIdx: number, rowIdx: number, items: string[]) => {
    updateResume(setProfile, r => {
      const block = r.skillBlocks[blockIdx]
      return {
        ...r,
        skillBlocks: replaceAt(r.skillBlocks, blockIdx, {
          rows: replaceAt(block.rows, rowIdx, { items }),
        }),
      }
    })
  }

  return (
    <Section title='CV Skills' badge='rows are layout'>
      <div className='space-y-4'>
        <p className={helpTextCls}>
          Each row justifies edge to edge on the printed page, so row membership is a layout
          decision, not a grouping one — nine short items fit a row comfortably, five long ones do
          not. Separate items with commas or newlines.
        </p>

        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>Skill blocks</h2>
          <button
            type='button'
            className={secondaryBtnCls}
            onClick={() =>
              updateResume(setProfile, r => ({
                ...r,
                skillBlocks: [...r.skillBlocks, { heading: '', rows: [{ items: [] }] }],
              }))
            }
          >
            + Add block
          </button>
        </div>

        {resume.skillBlocks.length === 0 ? (
          <div className={emptyStateCls}>No skill blocks yet.</div>
        ) : null}

        {resume.skillBlocks.map((block, blockIdx) => (
          <div key={blockIdx} className={itemCardCls}>
            <div className='space-y-2'>
              <label className={labelCls}>Heading</label>
              <input
                className={inputCls}
                placeholder='TECHNICAL SKILLS'
                value={block.heading}
                onChange={e =>
                  updateResume(setProfile, r => ({
                    ...r,
                    skillBlocks: replaceAt(r.skillBlocks, blockIdx, { heading: e.target.value }),
                  }))
                }
              />
            </div>

            <div className='mt-4 space-y-3'>
              {block.rows.map((row, rowIdx) => (
                <div key={rowIdx} className={nestedItemCardCls}>
                  <div className='space-y-2'>
                    <label className={labelCls}>
                      Row {rowIdx + 1} · {row.items.length} items
                    </label>
                    <textarea
                      className={textareaCls}
                      rows={2}
                      value={row.items.join(', ')}
                      onChange={e => updateRow(blockIdx, rowIdx, parseRow(e.target.value))}
                    />
                  </div>
                  <div className='mt-3 flex justify-end'>
                    <button
                      type='button'
                      className={ghostBtnCls}
                      onClick={() =>
                        updateResume(setProfile, r => ({
                          ...r,
                          skillBlocks: replaceAt(r.skillBlocks, blockIdx, {
                            rows: block.rows.filter((_, i) => i !== rowIdx),
                          }),
                        }))
                      }
                    >
                      Remove row
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className='mt-3 flex justify-between'>
              <button
                type='button'
                className={secondaryBtnCls}
                onClick={() =>
                  updateResume(setProfile, r => ({
                    ...r,
                    skillBlocks: replaceAt(r.skillBlocks, blockIdx, {
                      rows: [...block.rows, { items: [] }],
                    }),
                  }))
                }
              >
                + Add row
              </button>
              <button
                type='button'
                className={ghostBtnCls}
                onClick={() =>
                  updateResume(setProfile, r => ({
                    ...r,
                    skillBlocks: r.skillBlocks.filter((_, i) => i !== blockIdx),
                  }))
                }
              >
                Remove block
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
