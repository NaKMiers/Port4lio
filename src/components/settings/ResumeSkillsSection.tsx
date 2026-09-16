import React from 'react'

import AddMoreButton from '@/components/settings/AddMoreButton'
import DragList from '@/components/settings/DragList'
import ListTextarea, { itemsToText, textToItems } from '@/components/settings/ListTextarea'
import Section from '@/components/settings/Section'
import { replaceAt, resumeOf, updateResume } from '@/components/settings/resume-utils'
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
import type { CvSectionProps } from '@/components/settings/types'
import { moveItem } from '@/lib/resume-sections'

export default function ResumeSkillsSection({
  profile,
  setProfile,
  handle,
  onFitPageBreak,
}: CvSectionProps) {
  const resume = resumeOf(profile)

  const addBlock = () =>
    updateResume(setProfile, r => ({
      ...r,
      skillBlocks: [...r.skillBlocks, { heading: '', rows: [{ items: [] }] }],
    }))

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

  const moveBlock = (from: number, to: number) => {
    updateResume(setProfile, r => ({ ...r, skillBlocks: moveItem(r.skillBlocks, from, to) }))
    onFitPageBreak?.()
  }

  const moveRow = (blockIdx: number, from: number, to: number) => {
    updateResume(setProfile, r => {
      const block = r.skillBlocks[blockIdx]
      return {
        ...r,
        skillBlocks: replaceAt(r.skillBlocks, blockIdx, { rows: moveItem(block.rows, from, to) }),
      }
    })
    onFitPageBreak?.()
  }

  return (
    <Section id='cv-skills' title='CV Skills' badge='rows are layout' handle={handle}>
      <div className='space-y-4'>
        <p className={helpTextCls}>
          Each row justifies edge to edge on the printed page, so row membership is a layout
          decision, not a grouping one — nine short items fit a row comfortably, five long ones do
          not. Separate items with commas or newlines. Blocks print in the order shown here.
        </p>

        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>Skill blocks</h2>
          <button type='button' className={secondaryBtnCls} onClick={addBlock}>
            + Add block
          </button>
        </div>

        {resume.skillBlocks.length === 0 ? (
          <div className={emptyStateCls}>No skill blocks yet.</div>
        ) : null}

        <DragList
          ids={resume.skillBlocks.map((_, idx) => `block-${idx}`)}
          onReorder={moveBlock}
          itemLabel='skill block'
        >
          {(blockIdx, blockHandle) => {
            const block = resume.skillBlocks[blockIdx]
            return (
              <div className={itemCardCls}>
                <div className='flex items-end gap-2'>
                  <div className='min-w-0 flex-1 space-y-2'>
                    <label className={labelCls}>Heading</label>
                    <input
                      className={inputCls}
                      placeholder='TECHNICAL SKILLS'
                      value={block.heading}
                      onChange={e =>
                        updateResume(setProfile, r => ({
                          ...r,
                          skillBlocks: replaceAt(r.skillBlocks, blockIdx, {
                            heading: e.target.value,
                          }),
                        }))
                      }
                    />
                  </div>
                  <div className='pb-2'>{blockHandle}</div>
                </div>

                <div className='mt-4'>
                  <DragList
                    ids={block.rows.map((_, idx) => `row-${idx}`)}
                    onReorder={(from, to) => moveRow(blockIdx, from, to)}
                    itemLabel='skill row'
                  >
                    {(rowIdx, rowHandle) => {
                      const row = block.rows[rowIdx]
                      return (
                        <div className={nestedItemCardCls}>
                          <div className='flex items-start gap-2'>
                            <div className='min-w-0 flex-1 space-y-2'>
                              <label className={labelCls}>
                                Row {rowIdx + 1} · {row.items.length} items
                              </label>
                              <ListTextarea
                                className={textareaCls}
                                rows={2}
                                value={row.items}
                                join={itemsToText}
                                parse={textToItems}
                                onChange={items => updateRow(blockIdx, rowIdx, items)}
                              />
                            </div>
                            <div className='pt-6'>{rowHandle}</div>
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
                      )
                    }}
                  </DragList>
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
            )
          }}
        </DragList>

        {resume.skillBlocks.length > 0 ? (
          <AddMoreButton label='+ Add skill block' onClick={addBlock} />
        ) : null}
      </div>
    </Section>
  )
}
