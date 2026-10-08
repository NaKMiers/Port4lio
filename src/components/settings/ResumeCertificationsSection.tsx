import React from 'react'

import AddMoreButton from '@/components/settings/AddMoreButton'
import DragList from '@/components/settings/DragList'
import Section from '@/components/settings/Section'
import { replaceAt } from '@/components/settings/resume-utils'
import {
  emptyStateCls,
  ghostBtnCls,
  helpTextCls,
  inputCls,
  itemCardCls,
  labelCls,
  nestedItemCardCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import type { CvSectionProps } from '@/components/settings/types'
import { moveItem } from '@/lib/resume-sections'
import type { Certificate, ResumeCertificationGroup } from '@/types/profile'

export default function ResumeCertificationsSection({
  resume,
  setResume,
  handle,
  onFitPageBreak,
}: CvSectionProps) {
  const addGroup = () =>
    setResume(r => ({
      ...r,
      certifications: {
        ...r.certifications,
        groups: [...r.certifications.groups, { issuer: '', items: [] }],
      },
    }))

  const updateGroup = (
    idx: number,
    patch: Partial<ResumeCertificationGroup>
  ) => {
    setResume(r => ({
      ...r,
      certifications: {
        ...r.certifications,
        groups: replaceAt(r.certifications.groups, idx, patch),
      },
    }))
  }

  const updateCert = (
    groupIdx: number,
    certIdx: number,
    patch: Partial<Certificate>
  ) => {
    setResume(r => {
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

  const moveGroup = (from: number, to: number) => {
    setResume(r => ({
      ...r,
      certifications: {
        ...r.certifications,
        groups: moveItem(r.certifications.groups, from, to),
      },
    }))
    onFitPageBreak?.()
  }

  const moveCert = (groupIdx: number, from: number, to: number) => {
    setResume(r => {
      const group = r.certifications.groups[groupIdx]
      return {
        ...r,
        certifications: {
          ...r.certifications,
          groups: replaceAt(r.certifications.groups, groupIdx, {
            items: moveItem(group.items, from, to),
          }),
        },
      }
    })
    onFitPageBreak?.()
  }

  return (
    <Section
      id="cv-certifications"
      title="CV Certifications"
      handle={handle}
    >
      <div className="space-y-4">
        <p className={helpTextCls}>
          Each group prints as one line: the issuer in bold, then its
          certificates separated by dots. Groups and the certificates inside
          them print in the order shown here.
        </p>

        <div className="space-y-2">
          <label className={labelCls}>Heading</label>
          <input
            className={inputCls}
            placeholder="CERTIFICATIONS"
            value={resume.certifications.heading}
            onChange={e =>
              setResume(r => ({
                ...r,
                certifications: {
                  ...r.certifications,
                  heading: e.target.value,
                },
              }))
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Certification groups</h2>
          <button
            type="button"
            className={secondaryBtnCls}
            onClick={addGroup}
          >
            + Add group
          </button>
        </div>

        {resume.certifications.groups.length === 0 ? (
          <div className={emptyStateCls}>No certification groups yet.</div>
        ) : null}

        <DragList
          ids={resume.certifications.groups.map((_, idx) => `group-${idx}`)}
          onReorder={moveGroup}
          itemLabel="certification group"
        >
          {(groupIdx, groupHandle) => {
            const group = resume.certifications.groups[groupIdx]
            return (
              <div className={itemCardCls}>
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <label className={labelCls}>Issuer</label>
                    <input
                      className={inputCls}
                      placeholder="Anthropic, 2026"
                      value={group.issuer}
                      onChange={e =>
                        updateGroup(groupIdx, { issuer: e.target.value })
                      }
                    />
                  </div>
                  <div className="pb-2">{groupHandle}</div>
                </div>

                <div className="mt-4">
                  <DragList
                    ids={group.items.map((_, idx) => `cert-${idx}`)}
                    onReorder={(from, to) => moveCert(groupIdx, from, to)}
                    itemLabel="certificate"
                  >
                    {(certIdx, certHandle) => {
                      const cert = group.items[certIdx]
                      return (
                        <div className={nestedItemCardCls}>
                          <div className="flex items-start gap-2">
                            <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                              <div className="space-y-2">
                                <label className={labelCls}>Name</label>
                                <input
                                  className={inputCls}
                                  value={cert.name}
                                  onChange={e =>
                                    updateCert(groupIdx, certIdx, {
                                      name: e.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                <label className={labelCls}>Link</label>
                                <input
                                  className={inputCls}
                                  value={cert.link}
                                  onChange={e =>
                                    updateCert(groupIdx, certIdx, {
                                      link: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>
                            <div className="pt-6">{certHandle}</div>
                          </div>
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              className={ghostBtnCls}
                              onClick={() =>
                                updateGroup(groupIdx, {
                                  items: group.items.filter(
                                    (_, i) => i !== certIdx
                                  ),
                                })
                              }
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      )
                    }}
                  </DragList>
                </div>

                <div className="mt-3 flex justify-between">
                  <button
                    type="button"
                    className={secondaryBtnCls}
                    onClick={() =>
                      updateGroup(groupIdx, {
                        items: [...group.items, { name: '', link: '' }],
                      })
                    }
                  >
                    + Add certificate
                  </button>
                  <button
                    type="button"
                    className={ghostBtnCls}
                    onClick={() =>
                      setResume(r => ({
                        ...r,
                        certifications: {
                          ...r.certifications,
                          groups: r.certifications.groups.filter(
                            (_, i) => i !== groupIdx
                          ),
                        },
                      }))
                    }
                  >
                    Remove group
                  </button>
                </div>
              </div>
            )
          }}
        </DragList>

        {resume.certifications.groups.length > 0 ? (
          <AddMoreButton
            label="+ Add certification group"
            onClick={addGroup}
          />
        ) : null}
      </div>
    </Section>
  )
}
