import React from 'react'

import { CV_FALLBACK_PHOTO } from '@/lib/resume-seed'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'
import AddMoreButton from '@/components/settings/AddMoreButton'
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
import { replaceAt, resumeOf, updateResume } from '@/components/settings/resume-utils'
import type { UploadingState } from '@/components/settings/types'
import type { Profile, ResumeContactLink } from '@/types/profile'

export default function ResumeMastheadSection({
  profile,
  setProfile,
  uploading,
  setUploading,
  setError,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  uploading: UploadingState
  setUploading: React.Dispatch<React.SetStateAction<UploadingState>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const resume = resumeOf(profile)
  const { contact } = resume

  // An empty `resume.photo` means "inherit". Mirroring the full chain `/cv` resolves at
  // render time means this preview shows what will actually print, not what is stored.
  const inheritsAvatar = !resume.photo
  const effectivePhoto = resume.photo || profile.avatar || CV_FALLBACK_PHOTO

  const addLink = () =>
    updateResume(setProfile, r => ({
      ...r,
      contact: { ...r.contact, links: [...r.contact.links, { label: '', text: '', href: '' }] },
    }))

  const updateLink = (idx: number, patch: Partial<ResumeContactLink>) => {
    updateResume(setProfile, r => ({
      ...r,
      contact: { ...r.contact, links: replaceAt(r.contact.links, idx, patch) },
    }))
  }

  return (
    <Section id='cv-masthead' title='CV Masthead' badge='name, role, contact' defaultOpen>
      <div className='space-y-4'>
        <p className={helpTextCls}>
          Printed at the top of <strong>/cv</strong>. The vertical pipes between contact items use
          gaps measured against these exact strings — after changing the email, phone or location,
          open /cv and check the spacing by eye. The overflow test only measures height, so it
          cannot catch a pipe that sits wrong.
        </p>

        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <div className='space-y-2'>
            <label className={labelCls}>Name</label>
            <input
              className={inputCls}
              value={resume.name}
              onChange={e => updateResume(setProfile, r => ({ ...r, name: e.target.value }))}
            />
          </div>
          <div className='space-y-2'>
            <label className={labelCls}>Role</label>
            <input
              className={inputCls}
              value={resume.role}
              onChange={e => updateResume(setProfile, r => ({ ...r, role: e.target.value }))}
            />
          </div>
        </div>

        <div className={itemCardCls}>
          <div className='flex items-center justify-between gap-3'>
            <label className={labelCls}>CV photo</label>
            {uploading.cvPhoto ? <Spinner className='text-pp-muted' /> : null}
          </div>
          <p className={helpTextCls}>
            Defaults to your profile avatar. Upload one here only when the printed CV should use a
            different picture — it is cropped to a circle, so a head-and-shoulders shot works best.
            Max {MAX_UPLOAD_MB_LABEL} MB, uploads immediately.
          </p>

          <div className='mt-3 grid grid-cols-1 items-start gap-4 md:grid-cols-[auto_minmax(0,1fr)]'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={effectivePhoto}
              alt='CV photo preview'
              className='h-24 w-24 rounded-full border-2 border-pp-text object-cover shadow-[0_14px_28px_rgba(46,35,28,0.08)]'
            />

            <div className='space-y-3'>
              <input
                type='file'
                aria-label='Upload CV photo'
                accept='image/*'
                disabled={uploading.cvPhoto}
                className={uploadInputCls}
                onChange={async e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  if (file.size > MAX_UPLOAD_BYTES) {
                    setError(`Image must be ${MAX_UPLOAD_MB_LABEL} MB or smaller`)
                    return
                  }
                  setError(null)
                  setUploading(u => ({ ...u, cvPhoto: true }))
                  try {
                    const url = await uploadAssetToCloudinary(file, 'cv-photo')
                    updateResume(setProfile, r => ({ ...r, photo: url }))
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Upload failed')
                  } finally {
                    setUploading(u => ({ ...u, cvPhoto: false }))
                  }
                }}
              />

              <div className='space-y-2'>
                <label className={labelCls}>Photo URL</label>
                <input
                  className={inputCls}
                  value={resume.photo}
                  placeholder={profile.avatar || 'Leave empty to use your profile avatar'}
                  onChange={e => updateResume(setProfile, r => ({ ...r, photo: e.target.value }))}
                />
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                <button
                  type='button'
                  className={ghostBtnCls}
                  disabled={inheritsAvatar}
                  onClick={() => updateResume(setProfile, r => ({ ...r, photo: '' }))}
                >
                  Use profile avatar
                </button>
                <span className={helpTextCls}>
                  {inheritsAvatar
                    ? profile.avatar
                      ? 'Using your profile avatar.'
                      : 'No profile avatar set — the CV falls back to its bundled photo.'
                    : 'Using the CV-specific photo above.'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className={itemCardCls}>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
            <div className='space-y-2'>
              <label className={labelCls}>Email</label>
              <input
                className={inputCls}
                value={contact.email}
                onChange={e =>
                  updateResume(setProfile, r => ({
                    ...r,
                    contact: { ...r.contact, email: e.target.value },
                  }))
                }
              />
            </div>
            <div className='space-y-2'>
              <label className={labelCls}>Phone</label>
              <input
                className={inputCls}
                value={contact.phone}
                onChange={e =>
                  updateResume(setProfile, r => ({
                    ...r,
                    contact: { ...r.contact, phone: e.target.value },
                  }))
                }
              />
            </div>
            <div className='space-y-2'>
              <label className={labelCls}>Location</label>
              <input
                className={inputCls}
                value={contact.location}
                onChange={e =>
                  updateResume(setProfile, r => ({
                    ...r,
                    contact: { ...r.contact, location: e.target.value },
                  }))
                }
              />
            </div>
          </div>
          <p className={`${helpTextCls} mt-3`}>
            These three are printed on the public CV page but are kept out of the public profile
            API, so they are not served as machine-readable JSON.
          </p>
        </div>

        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>Contact links</h2>
          <button
            type='button'
            className={secondaryBtnCls}
            onClick={addLink}
          >
            + Add
          </button>
        </div>

        {contact.links.length === 0 ? (
          <div className={emptyStateCls}>No contact links yet.</div>
        ) : null}

        {contact.links.map((link, idx) => (
          <div key={idx} className={itemCardCls}>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
              <div className='space-y-2'>
                <label className={labelCls}>Label</label>
                <input
                  className={inputCls}
                  placeholder='Portfolio'
                  value={link.label}
                  onChange={e => updateLink(idx, { label: e.target.value })}
                />
              </div>
              <div className='space-y-2'>
                <label className={labelCls}>Anchor text</label>
                <input
                  className={inputCls}
                  placeholder='anhkhoa.info'
                  value={link.text}
                  onChange={e => updateLink(idx, { text: e.target.value })}
                />
              </div>
              <div className='space-y-2'>
                <label className={labelCls}>Href</label>
                <input
                  className={inputCls}
                  value={link.href}
                  onChange={e => updateLink(idx, { href: e.target.value })}
                />
              </div>
            </div>
            <div className='mt-3 flex justify-end'>
              <button
                type='button'
                className={ghostBtnCls}
                onClick={() =>
                  updateResume(setProfile, r => ({
                    ...r,
                    contact: { ...r.contact, links: r.contact.links.filter((_, i) => i !== idx) },
                  }))
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {contact.links.length > 0 ? (
          <AddMoreButton label='+ Add contact link' onClick={addLink} />
        ) : null}
      </div>
    </Section>
  )
}
