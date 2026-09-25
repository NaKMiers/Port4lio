import React from 'react'

import { CV_FALLBACK_PHOTO } from '@/lib/resume-seed'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'
import AddMoreButton from '@/components/settings/AddMoreButton'
import DragList from '@/components/settings/DragList'
import Section from '@/components/settings/Section'
import Spinner from '@/components/settings/Spinner'
import {
  emptyStateCls,
  ghostBtnCls,
  helpTextCls,
  inputCls,
  itemCardCls,
  labelCls,
  MAX_UPLOAD_MB_LABEL,
  secondaryBtnCls,
  uploadAssetToCloudinary,
  uploadInputCls,
} from '@/components/settings/settings-utils'
import { replaceAt } from '@/components/settings/resume-utils'
import { moveItem } from '@/lib/resume-sections'
import type { UploadingState } from '@/components/settings/types'
import type { Resume, ResumeContactLink } from '@/types/profile'

export default function ResumeMastheadSection({
  resume,
  setResume,
  avatar,
  uploading,
  setUploading,
  setError,
}: {
  resume: Resume
  setResume: React.Dispatch<React.SetStateAction<Resume>>
  /** The portfolio avatar, which an unset CV photo inherits. */
  avatar: string
  uploading: UploadingState
  setUploading: React.Dispatch<React.SetStateAction<UploadingState>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const { contact } = resume

  // An empty `resume.photo` means "inherit". Mirroring the full chain `/cv` resolves at
  // render time means this preview shows what will actually print, not what is stored.
  const inheritsAvatar = !resume.photo
  const effectivePhoto = resume.photo || avatar || CV_FALLBACK_PHOTO

  const addLink = () =>
    setResume(r => ({
      ...r,
      contact: {
        ...r.contact,
        links: [...r.contact.links, { label: '', text: '', href: '' }],
      },
    }))

  const updateLink = (idx: number, patch: Partial<ResumeContactLink>) => {
    setResume(r => ({
      ...r,
      contact: { ...r.contact, links: replaceAt(r.contact.links, idx, patch) },
    }))
  }

  const moveLink = (from: number, to: number) =>
    setResume(r => ({
      ...r,
      contact: { ...r.contact, links: moveItem(r.contact.links, from, to) },
    }))

  return (
    <Section
      id="cv-masthead"
      title="CV Masthead"
      defaultOpen
    >
      <div className="space-y-4">
        <p className={helpTextCls}>
          Printed at the top of <strong>/cv</strong>. The vertical pipes between
          contact items use gaps measured against these exact strings - after
          changing the email, phone or location, open /cv and check the spacing
          by eye. The overflow test only measures height, so it cannot catch a
          pipe that sits wrong.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              value={resume.name}
              onChange={e => setResume(r => ({ ...r, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className={labelCls}>Role</label>
            <input
              className={inputCls}
              value={resume.role}
              onChange={e => setResume(r => ({ ...r, role: e.target.value }))}
            />
          </div>
        </div>

        <div className={itemCardCls}>
          <div className="flex items-center justify-between gap-3">
            <label className={labelCls}>CV photo</label>
            <div className="flex items-center gap-2">
              {uploading.cvPhoto ? <Spinner className="text-pp-muted" /> : null}
              <button
                type="button"
                className={ghostBtnCls}
                onClick={() =>
                  setResume(r => ({
                    ...r,
                    hidePhoto: !r.hidePhoto,
                  }))
                }
              >
                {resume.hidePhoto ? 'Show avatar on CV' : 'Hide avatar on CV'}
              </button>
            </div>
          </div>
          <p className={helpTextCls}>
            Defaults to your profile avatar. Upload one here only when the
            printed CV should use a different picture - it is cropped to a
            circle, so a head-and-shoulders shot works best. Max{' '}
            {MAX_UPLOAD_MB_LABEL} MB, uploads immediately.
          </p>
          {resume.hidePhoto ? (
            <p className={`${helpTextCls} mt-1 font-semibold text-pp-text`}>
              Hidden on the printed CV - name, role and contact reclaim the
              width it used, all the way to the right margin. The photo below is
              kept, so switching this back on restores it without a re-upload.
            </p>
          ) : null}

          <div
            className={`mt-3 grid grid-cols-1 items-start gap-4 md:grid-cols-[auto_minmax(0,1fr)] ${
              resume.hidePhoto ? 'opacity-50' : ''
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={effectivePhoto}
              alt="CV photo preview"
              className="h-24 w-24 rounded-full border-2 border-pp-text object-cover shadow-[0_14px_28px_rgba(46,35,28,0.08)]"
            />

            <div className="space-y-3">
              <input
                type="file"
                aria-label="Upload CV photo"
                accept="image/*"
                disabled={uploading.cvPhoto}
                className={uploadInputCls}
                onChange={async e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  if (file.size > MAX_UPLOAD_BYTES) {
                    setError(
                      `Image must be ${MAX_UPLOAD_MB_LABEL} MB or smaller`
                    )
                    return
                  }
                  setError(null)
                  setUploading(u => ({ ...u, cvPhoto: true }))
                  try {
                    const url = await uploadAssetToCloudinary(file, 'cv-photo')
                    setResume(r => ({ ...r, photo: url }))
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : 'Upload failed'
                    )
                  } finally {
                    setUploading(u => ({ ...u, cvPhoto: false }))
                  }
                }}
              />

              <div className="space-y-2">
                <label className={labelCls}>Photo URL</label>
                <input
                  className={inputCls}
                  value={resume.photo}
                  placeholder={
                    avatar || 'Leave empty to use your profile avatar'
                  }
                  onChange={e =>
                    setResume(r => ({
                      ...r,
                      photo: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={ghostBtnCls}
                  disabled={inheritsAvatar}
                  onClick={() => setResume(r => ({ ...r, photo: '' }))}
                >
                  Use profile avatar
                </button>
                <span className={helpTextCls}>
                  {inheritsAvatar
                    ? avatar
                      ? 'Using your profile avatar.'
                      : 'No profile avatar set - the CV falls back to its bundled photo.'
                    : 'Using the CV-specific photo above.'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className={itemCardCls}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className={labelCls}>Email</label>
              <input
                className={inputCls}
                value={contact.email}
                onChange={e =>
                  setResume(r => ({
                    ...r,
                    contact: { ...r.contact, email: e.target.value },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className={labelCls}>Phone</label>
              <input
                className={inputCls}
                value={contact.phone}
                onChange={e =>
                  setResume(r => ({
                    ...r,
                    contact: { ...r.contact, phone: e.target.value },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className={labelCls}>Location</label>
              <input
                className={inputCls}
                value={contact.location}
                onChange={e =>
                  setResume(r => ({
                    ...r,
                    contact: { ...r.contact, location: e.target.value },
                  }))
                }
              />
            </div>
          </div>
          <p className={`${helpTextCls} mt-3`}>
            These three are printed on the public CV page but are kept out of
            the public profile API, so they are not served as machine-readable
            JSON.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Contact links</h2>
          <button
            type="button"
            className={secondaryBtnCls}
            onClick={addLink}
          >
            + Add
          </button>
        </div>

        {contact.links.length === 0 ? (
          <div className={emptyStateCls}>No contact links yet.</div>
        ) : null}

        <DragList
          ids={contact.links.map((_, idx) => `link-${idx}`)}
          onReorder={moveLink}
          itemLabel="contact link"
        >
          {(idx, linkHandle) => {
            const link = contact.links[idx]
            return (
              <div className={itemCardCls}>
                <div className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-2">
                      <label className={labelCls}>Label</label>
                      <input
                        className={inputCls}
                        placeholder="Portfolio"
                        value={link.label}
                        onChange={e =>
                          updateLink(idx, { label: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className={labelCls}>Anchor text</label>
                      <input
                        className={inputCls}
                        placeholder="anhkhoa.info"
                        value={link.text}
                        onChange={e =>
                          updateLink(idx, { text: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className={labelCls}>Href</label>
                      <input
                        className={inputCls}
                        value={link.href}
                        onChange={e =>
                          updateLink(idx, { href: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="pt-6">{linkHandle}</div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className={ghostBtnCls}
                    onClick={() =>
                      setResume(r => ({
                        ...r,
                        contact: {
                          ...r.contact,
                          links: r.contact.links.filter((_, i) => i !== idx),
                        },
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          }}
        </DragList>

        {contact.links.length > 0 ? (
          <AddMoreButton
            label="+ Add contact link"
            onClick={addLink}
          />
        ) : null}
      </div>
    </Section>
  )
}
