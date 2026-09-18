import React from 'react'

import AddMoreButton from '@/components/settings/AddMoreButton'
import DragList from '@/components/settings/DragList'
import ListTextarea, { linesToText, textToLines } from '@/components/settings/ListTextarea'
import NumberField from '@/components/settings/NumberField'
import Section from '@/components/settings/Section'
import { BOLD_HINT, replaceAt, resumeOf, updateResume } from '@/components/settings/resume-utils'
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
import { stripInlineBold } from '@/lib/resume-inline'
import { moveItem } from '@/lib/resume-sections'
import type { Resume, ResumeLink, ResumeProject } from '@/types/profile'

/** Plain-English rendering of the page-break coordinate, plus whether it resolves. */
function describePageBreak(resume: Resume): { text: string; valid: boolean } {
  const { sectionIndex, projectIndex, highlightsOnFirstSheet } = resume.pageBreak
  const section = resume.projectSections[sectionIndex]
  const project = section?.items[projectIndex]

  if (!section || !project) {
    return {
      text: `No project at section ${sectionIndex}, project ${projectIndex} - the break will fall back to the nearest project boundary.`,
      valid: false,
    }
  }

  const total = project.highlights.length
  const title = stripInlineBold(project.title) || `project ${projectIndex + 1}`
  const clamped = Math.min(highlightsOnFirstSheet, total)
  const suffix =
    highlightsOnFirstSheet > total
      ? ` (clamped from ${highlightsOnFirstSheet} - this project has only ${total})`
      : ''

  return {
    text: `Sheet 1 ends after: ${section.heading} → ${title} → highlight ${clamped} of ${total}${suffix}`,
    valid: highlightsOnFirstSheet <= total,
  }
}

/**
 * Where an index ends up once the entry at `from` is spliced in at `to`.
 *
 * The page break addresses a project by position, so a reorder that did not carry it along
 * would point it at whatever project slid into that slot. This only keeps the coordinate
 * pointing at the same project - it says nothing about whether that project still falls on
 * sheet 1, which is why every reorder also asks `useCvPageBreakFit` to re-measure. The
 * remap is what holds until that lands, and the fallback if there is no bullet list to cut.
 */
function indexAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to
  if (from < to) return index > from && index <= to ? index - 1 : index
  return index >= to && index < from ? index + 1 : index
}

export default function ResumeProjectsSection({
  profile,
  setProfile,
  handle,
  onFitPageBreak,
}: CvSectionProps) {
  const resume = resumeOf(profile)
  const summary = describePageBreak(resume)

  const updateProject = (sectionIdx: number, projectIdx: number, patch: Partial<ResumeProject>) => {
    updateResume(setProfile, r => {
      const section = r.projectSections[sectionIdx]
      return {
        ...r,
        projectSections: replaceAt(r.projectSections, sectionIdx, {
          items: replaceAt(section.items, projectIdx, patch),
        }),
      }
    })
  }

  const updateDemoLink = (
    sectionIdx: number,
    projectIdx: number,
    linkIdx: number,
    patch: Partial<ResumeLink>
  ) => {
    const project = resume.projectSections[sectionIdx].items[projectIdx]
    updateProject(sectionIdx, projectIdx, {
      demoLinks: replaceAt(project.demoLinks, linkIdx, patch),
    })
  }

  const addSection = () =>
    updateResume(setProfile, r => ({
      ...r,
      projectSections: [...r.projectSections, { heading: '', items: [] }],
    }))

  const setBreak = (patch: Partial<Resume['pageBreak']>) => {
    updateResume(setProfile, r => ({ ...r, pageBreak: { ...r.pageBreak, ...patch } }))
  }

  const moveSection = (from: number, to: number) => {
    updateResume(setProfile, r => ({
      ...r,
      projectSections: moveItem(r.projectSections, from, to),
      pageBreak: {
        ...r.pageBreak,
        sectionIndex: indexAfterMove(r.pageBreak.sectionIndex, from, to),
      },
    }))
    onFitPageBreak?.()
  }

  const moveProject = (sectionIdx: number, from: number, to: number) => {
    updateResume(setProfile, r => {
      const section = r.projectSections[sectionIdx]
      return {
        ...r,
        projectSections: replaceAt(r.projectSections, sectionIdx, {
          items: moveItem(section.items, from, to),
        }),
        pageBreak:
          r.pageBreak.sectionIndex === sectionIdx
            ? { ...r.pageBreak, projectIndex: indexAfterMove(r.pageBreak.projectIndex, from, to) }
            : r.pageBreak,
      }
    })
    onFitPageBreak?.()
  }

  return (
    <Section id='cv-projects' title='CV Projects' badge='personal & work' handle={handle}>
      <div className='space-y-4'>
        <div className={itemCardCls}>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-sm font-semibold'>Page break</h2>
            {onFitPageBreak ? (
              <button type='button' className={secondaryBtnCls} onClick={onFitPageBreak}>
                Fit to sheet 1
              </button>
            ) : null}
          </div>
          <p className={`${helpTextCls} mt-1`}>
            The CV is two fixed A4 sheets and content past the edge is clipped, not reflowed. This
            coordinate says where sheet 1 stops. Reordering anything re-measures the real sheets
            and moves it to the last bullet that still fits; <strong>Fit to sheet 1</strong> does
            the same on demand, after an edit that changed how long the copy runs.
          </p>

          <div
            className={`mt-3 rounded-[1rem] border px-4 py-3 text-xs font-medium ${
              summary.valid
                ? 'border-pp-line bg-white/60 text-pp-text'
                : 'border-[#c98a8a] bg-[#fdf3f3] text-[#7f2f2f]'
            }`}
          >
            {summary.text}
          </div>

          <div className='mt-3 grid grid-cols-1 gap-3 md:grid-cols-3'>
            <div className='space-y-2'>
              <label className={labelCls}>Section index</label>
              <NumberField
                className={inputCls}
                value={resume.pageBreak.sectionIndex}
                onChange={sectionIndex => setBreak({ sectionIndex })}
              />
            </div>
            <div className='space-y-2'>
              <label className={labelCls}>Project index</label>
              <NumberField
                className={inputCls}
                value={resume.pageBreak.projectIndex}
                onChange={projectIndex => setBreak({ projectIndex })}
              />
            </div>
            <div className='space-y-2'>
              <label className={labelCls}>Highlights on sheet 1</label>
              <NumberField
                className={inputCls}
                value={resume.pageBreak.highlightsOnFirstSheet}
                onChange={highlightsOnFirstSheet => setBreak({ highlightsOnFirstSheet })}
              />
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>Project sections</h2>
          <button type='button' className={secondaryBtnCls} onClick={addSection}>
            + Add section
          </button>
        </div>

        {resume.projectSections.length === 0 ? (
          <div className={emptyStateCls}>No project sections yet.</div>
        ) : null}

        <DragList
          ids={resume.projectSections.map((_, idx) => `section-${idx}`)}
          onReorder={moveSection}
          itemLabel='project section'
        >
          {(sectionIdx, sectionHandle) => {
            const section = resume.projectSections[sectionIdx]
            return (
              <div className={itemCardCls}>
                <div className='flex items-end gap-2'>
                  <div className='min-w-0 flex-1 space-y-2'>
                    <label className={labelCls}>Section heading</label>
                    <input
                      className={inputCls}
                      placeholder='PERSONAL PROJECTS'
                      value={section.heading}
                      onChange={e =>
                        updateResume(setProfile, r => ({
                          ...r,
                          projectSections: replaceAt(r.projectSections, sectionIdx, {
                            heading: e.target.value,
                          }),
                        }))
                      }
                    />
                  </div>
                  <div className='pb-2'>{sectionHandle}</div>
                </div>

                <div className='mt-4'>
                  <DragList
                    ids={section.items.map((_, idx) => `project-${idx}`)}
                    onReorder={(from, to) => moveProject(sectionIdx, from, to)}
                    itemLabel='project'
                  >
                    {(projectIdx, projectHandle) => {
                      const project = section.items[projectIdx]
                      return (
                        <div className={nestedItemCardCls}>
                          <div className='flex items-start gap-2'>
                            <div className='grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3'>
                              <div className='space-y-2'>
                                <label className={labelCls}>Employer</label>
                                <input
                                  className={inputCls}
                                  placeholder='Rikkeisoft (blank for personal)'
                                  value={project.employer}
                                  onChange={e =>
                                    updateProject(sectionIdx, projectIdx, {
                                      employer: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div className='space-y-2'>
                                <label className={labelCls}>Title</label>
                                <input
                                  className={inputCls}
                                  value={project.title}
                                  onChange={e =>
                                    updateProject(sectionIdx, projectIdx, { title: e.target.value })
                                  }
                                />
                              </div>
                              <div className='space-y-2'>
                                <label className={labelCls}>Period</label>
                                <input
                                  className={inputCls}
                                  placeholder='02/2025 - current'
                                  value={project.period}
                                  onChange={e =>
                                    updateProject(sectionIdx, projectIdx, {
                                      period: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>
                            <div className='pt-6'>{projectHandle}</div>
                          </div>

                          <div className='mt-3 space-y-2'>
                            <label className={labelCls}>Details · one line each</label>
                            <ListTextarea
                              className={textareaCls}
                              rows={5}
                              value={project.details}
                              join={linesToText}
                              parse={textToLines}
                              onChange={details =>
                                updateProject(sectionIdx, projectIdx, { details })
                              }
                            />
                          </div>

                          <div className='mt-3 space-y-2'>
                            <label className={labelCls}>
                              Highlights · {project.highlights.length} bullets
                            </label>
                            <ListTextarea
                              className={textareaCls}
                              rows={5}
                              value={project.highlights}
                              join={linesToText}
                              parse={textToLines}
                              onChange={highlights =>
                                updateProject(sectionIdx, projectIdx, { highlights })
                              }
                            />
                          </div>

                          <div className='mt-3'>
                            <DragList
                              ids={project.demoLinks.map((_, idx) => `demo-${idx}`)}
                              onReorder={(from, to) => {
                                updateProject(sectionIdx, projectIdx, {
                                  demoLinks: moveItem(project.demoLinks, from, to),
                                })
                                onFitPageBreak?.()
                              }}
                              itemLabel='demo link'
                              className='space-y-2'
                            >
                              {(linkIdx, linkHandle) => {
                                const link = project.demoLinks[linkIdx]
                                return (
                                  <div className='grid grid-cols-1 gap-2 md:grid-cols-[auto_1fr_2fr_auto] md:items-center'>
                                    <div className='hidden md:block'>{linkHandle}</div>
                                    <input
                                      className={inputCls}
                                      placeholder='App Store'
                                      value={link.label}
                                      onChange={e =>
                                        updateDemoLink(sectionIdx, projectIdx, linkIdx, {
                                          label: e.target.value,
                                        })
                                      }
                                    />
                                    <input
                                      className={inputCls}
                                      placeholder='https://…'
                                      value={link.href}
                                      onChange={e =>
                                        updateDemoLink(sectionIdx, projectIdx, linkIdx, {
                                          href: e.target.value,
                                        })
                                      }
                                    />
                                    <button
                                      type='button'
                                      className={ghostBtnCls}
                                      onClick={() =>
                                        updateProject(sectionIdx, projectIdx, {
                                          demoLinks: project.demoLinks.filter(
                                            (_, i) => i !== linkIdx
                                          ),
                                        })
                                      }
                                    >
                                      Remove
                                    </button>
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
                                updateProject(sectionIdx, projectIdx, {
                                  demoLinks: [...project.demoLinks, { label: '', href: '' }],
                                })
                              }
                            >
                              + Add demo link
                            </button>
                            <button
                              type='button'
                              className={ghostBtnCls}
                              onClick={() =>
                                updateResume(setProfile, r => ({
                                  ...r,
                                  projectSections: replaceAt(r.projectSections, sectionIdx, {
                                    items: section.items.filter((_, i) => i !== projectIdx),
                                  }),
                                }))
                              }
                            >
                              Remove project
                            </button>
                          </div>
                        </div>
                      )
                    }}
                  </DragList>
                </div>

                <p className={`${helpTextCls} mt-3`}>{BOLD_HINT}</p>

                <div className='mt-3 flex justify-between'>
                  <button
                    type='button'
                    className={secondaryBtnCls}
                    onClick={() =>
                      updateResume(setProfile, r => ({
                        ...r,
                        projectSections: replaceAt(r.projectSections, sectionIdx, {
                          items: [
                            ...section.items,
                            {
                              employer: '',
                              title: '',
                              period: '',
                              details: [],
                              highlights: [],
                              demoLinks: [],
                            },
                          ],
                        }),
                      }))
                    }
                  >
                    + Add project
                  </button>
                  <button
                    type='button'
                    className={ghostBtnCls}
                    onClick={() =>
                      updateResume(setProfile, r => ({
                        ...r,
                        projectSections: r.projectSections.filter((_, i) => i !== sectionIdx),
                      }))
                    }
                  >
                    Remove section
                  </button>
                </div>
              </div>
            )
          }}
        </DragList>

        {resume.projectSections.length > 0 ? (
          <AddMoreButton label='+ Add project section' onClick={addSection} />
        ) : null}
      </div>
    </Section>
  )
}
