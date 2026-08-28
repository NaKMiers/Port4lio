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
import { stripInlineBold } from '@/lib/resume-inline'
import type { Profile, Resume, ResumeLink, ResumeProject } from '@/types/profile'

/** Plain-English rendering of the page-break coordinate, plus whether it resolves. */
function describePageBreak(resume: Resume): { text: string; valid: boolean } {
  const { sectionIndex, projectIndex, highlightsOnFirstSheet } = resume.pageBreak
  const section = resume.projectSections[sectionIndex]
  const project = section?.items[projectIndex]

  if (!section || !project) {
    return {
      text: `No project at section ${sectionIndex}, project ${projectIndex} — the break will fall back to the nearest project boundary.`,
      valid: false,
    }
  }

  const total = project.highlights.length
  const title = stripInlineBold(project.title) || `project ${projectIndex + 1}`
  const clamped = Math.min(highlightsOnFirstSheet, total)
  const suffix =
    highlightsOnFirstSheet > total
      ? ` (clamped from ${highlightsOnFirstSheet} — this project has only ${total})`
      : ''

  return {
    text: `Sheet 1 ends after: ${section.heading} → ${title} → highlight ${clamped} of ${total}${suffix}`,
    valid: highlightsOnFirstSheet <= total,
  }
}

export default function ResumeProjectsSection({
  profile,
  setProfile,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
}) {
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

  const setBreak = (patch: Partial<Resume['pageBreak']>) => {
    updateResume(setProfile, r => ({ ...r, pageBreak: { ...r.pageBreak, ...patch } }))
  }

  return (
    <Section title='CV Projects' badge='personal & work'>
      <div className='space-y-4'>
        <div className={itemCardCls}>
          <h2 className='text-sm font-semibold'>Page break</h2>
          <p className={`${helpTextCls} mt-1`}>
            The CV is two fixed A4 sheets and content past the edge is clipped, not reflowed. This
            coordinate says where sheet 1 stops. After changing anything on this page, run{' '}
            <code>npm run test:e2e</code> — it fails loudly if a sheet overflows.
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
              <input
                className={inputCls}
                type='number'
                min={0}
                value={resume.pageBreak.sectionIndex}
                onChange={e => setBreak({ sectionIndex: Number(e.target.value) || 0 })}
              />
            </div>
            <div className='space-y-2'>
              <label className={labelCls}>Project index</label>
              <input
                className={inputCls}
                type='number'
                min={0}
                value={resume.pageBreak.projectIndex}
                onChange={e => setBreak({ projectIndex: Number(e.target.value) || 0 })}
              />
            </div>
            <div className='space-y-2'>
              <label className={labelCls}>Highlights on sheet 1</label>
              <input
                className={inputCls}
                type='number'
                min={0}
                value={resume.pageBreak.highlightsOnFirstSheet}
                onChange={e => setBreak({ highlightsOnFirstSheet: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>Project sections</h2>
          <button
            type='button'
            className={secondaryBtnCls}
            onClick={() =>
              updateResume(setProfile, r => ({
                ...r,
                projectSections: [...r.projectSections, { heading: '', items: [] }],
              }))
            }
          >
            + Add section
          </button>
        </div>

        {resume.projectSections.length === 0 ? (
          <div className={emptyStateCls}>No project sections yet.</div>
        ) : null}

        {resume.projectSections.map((section, sectionIdx) => (
          <div key={sectionIdx} className={itemCardCls}>
            <div className='space-y-2'>
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

            <div className='mt-4 space-y-3'>
              {section.items.map((project, projectIdx) => (
                <div key={projectIdx} className={nestedItemCardCls}>
                  <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                    <div className='space-y-2'>
                      <label className={labelCls}>Employer</label>
                      <input
                        className={inputCls}
                        placeholder='Rikkeisoft (blank for personal)'
                        value={project.employer}
                        onChange={e =>
                          updateProject(sectionIdx, projectIdx, { employer: e.target.value })
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
                          updateProject(sectionIdx, projectIdx, { period: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className='mt-3 space-y-2'>
                    <label className={labelCls}>Details · one line each</label>
                    <textarea
                      className={textareaCls}
                      rows={5}
                      value={linesToText(project.details)}
                      onChange={e =>
                        updateProject(sectionIdx, projectIdx, {
                          details: textToLines(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className='mt-3 space-y-2'>
                    <label className={labelCls}>
                      Highlights · {project.highlights.length} bullets
                    </label>
                    <textarea
                      className={textareaCls}
                      rows={5}
                      value={linesToText(project.highlights)}
                      onChange={e =>
                        updateProject(sectionIdx, projectIdx, {
                          highlights: textToLines(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className='mt-3 space-y-2'>
                    {project.demoLinks.map((link, linkIdx) => (
                      <div key={linkIdx} className='grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_auto]'>
                        <input
                          className={inputCls}
                          placeholder='App Store'
                          value={link.label}
                          onChange={e =>
                            updateDemoLink(sectionIdx, projectIdx, linkIdx, { label: e.target.value })
                          }
                        />
                        <input
                          className={inputCls}
                          placeholder='https://…'
                          value={link.href}
                          onChange={e =>
                            updateDemoLink(sectionIdx, projectIdx, linkIdx, { href: e.target.value })
                          }
                        />
                        <button
                          type='button'
                          className={ghostBtnCls}
                          onClick={() =>
                            updateProject(sectionIdx, projectIdx, {
                              demoLinks: project.demoLinks.filter((_, i) => i !== linkIdx),
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
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
              ))}
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
        ))}
      </div>
    </Section>
  )
}
