import React from 'react'

import type { Profile } from '@/types/profile'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'
import AddMoreButton from '@/components/settings/AddMoreButton'
import Section from '@/components/settings/Section'
import type { UploadingState } from '@/components/settings/types'
import Spinner from '@/components/settings/Spinner'
import {
  emptyStateCls,
  helpTextCls,
  itemCardCls,
  MAX_UPLOAD_MB_LABEL,
  ghostBtnCls,
  inputCls,
  labelCls,
  secondaryBtnCls,
  uploadAssetToCloudinary,
  uploadInputCls,
} from '@/components/settings/settings-utils'

export default function BasicsSection({
  profile,
  setProfile,
  preview,
  uploading,
  setUploading,
  setError,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  preview: { bg: string; av: string }
  uploading: UploadingState
  setUploading: React.Dispatch<React.SetStateAction<UploadingState>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const addJobTitle = () =>
    setProfile(p => ({ ...p, jobTitle: [...p.jobTitle, ''] }))

  return (
    <Section
      id="basics"
      title="Basics"
      badge="avatar, CV, headings"
      defaultOpen
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className={labelCls}>Avatar</label>
            {uploading.avatar ? <Spinner className="text-pp-muted" /> : null}
          </div>
          <p className={helpTextCls}>
            Max {MAX_UPLOAD_MB_LABEL} MB per image. Uploads immediately.
          </p>
          <input
            type="file"
            aria-label="Upload avatar image"
            accept="image/*"
            disabled={uploading.avatar}
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
              setUploading(u => ({ ...u, avatar: true }))
              try {
                const url = await uploadAssetToCloudinary(file, 'avatar')
                setProfile(p => ({ ...p, avatar: url }))
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Upload failed')
              } finally {
                setUploading(u => ({ ...u, avatar: false }))
              }
            }}
          />
          {uploading.avatar ? (
            <p className={helpTextCls}>Uploading...</p>
          ) : null}
          {preview.av ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.av}
              alt="Avatar preview"
              className="h-24 w-24 rounded-full border border-pp-line object-cover shadow-[0_14px_28px_rgba(46,35,28,0.08)]"
            />
          ) : (
            <div className={emptyStateCls}>Optional</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className={labelCls}>Background Image</label>
            {uploading.background ? (
              <Spinner className="text-pp-muted" />
            ) : null}
          </div>
          <p className={helpTextCls}>
            Max {MAX_UPLOAD_MB_LABEL} MB per image. Uploads immediately.
          </p>
          <input
            type="file"
            aria-label="Upload background image"
            accept="image/*"
            disabled={uploading.background}
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
              setUploading(u => ({ ...u, background: true }))
              try {
                const url = await uploadAssetToCloudinary(file, 'background')
                setProfile(p => ({ ...p, backgroundImage: url }))
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Upload failed')
              } finally {
                setUploading(u => ({ ...u, background: false }))
              }
            }}
          />
          {uploading.background ? (
            <p className={helpTextCls}>Uploading...</p>
          ) : null}
          {preview.bg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.bg}
              alt="Background preview"
              className="h-28 w-full rounded-[1.1rem] border border-pp-line object-cover shadow-[0_12px_24px_rgba(46,35,28,0.06)]"
            />
          ) : (
            <div className={emptyStateCls}>Optional</div>
          )}
        </div>

        <div className="space-y-2">
          <label className={labelCls}>Profile description</label>
          <input
            className={inputCls}
            value={profile.description}
            onChange={e =>
              setProfile(p => ({ ...p, description: e.target.value }))
            }
            placeholder="Short intro (e.g. Full-stack developer)"
          />
        </div>

        <div className="space-y-2">
          <label className={labelCls}>Full name</label>
          <input
            className={inputCls}
            value={profile.fullName}
            onChange={e =>
              setProfile(p => ({ ...p, fullName: e.target.value }))
            }
            placeholder="Your full name"
          />
        </div>

        <div className="space-y-2">
          <label className={labelCls}>Username</label>
          <input
            className={inputCls}
            value={profile.username}
            onChange={e =>
              setProfile(p => ({ ...p, username: e.target.value }))
            }
            placeholder="Your name/handle"
          />
        </div>

        <div className="space-y-3 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <label className={labelCls}>Job Titles</label>
            <button
              type="button"
              className={secondaryBtnCls}
              onClick={addJobTitle}
            >
              + Add
            </button>
          </div>
          {profile.jobTitle.length === 0 ? (
            <div className={emptyStateCls}>No job titles yet.</div>
          ) : null}
          <div className="space-y-2">
            {profile.jobTitle.map((title, idx) => (
              <div
                key={idx}
                className={itemCardCls}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className={inputCls}
                    value={title}
                    onChange={e =>
                      setProfile(p => {
                        const next = [...p.jobTitle]
                        next[idx] = e.target.value
                        return { ...p, jobTitle: next }
                      })
                    }
                    placeholder="e.g. Frontend Developer"
                  />
                  <button
                    type="button"
                    className={ghostBtnCls}
                    onClick={() =>
                      setProfile(p => ({
                        ...p,
                        jobTitle: p.jobTitle.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {profile.jobTitle.length > 0 ? (
              <AddMoreButton
                label="+ Add job title"
                onClick={addJobTitle}
              />
            ) : null}
          </div>
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className={labelCls}>Profile Heading</label>
          <input
            className={inputCls}
            value={profile.profileHeading}
            onChange={e =>
              setProfile(p => ({ ...p, profileHeading: e.target.value }))
            }
            placeholder="Main heading"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className={labelCls}>Profile Sub-heading</label>
          <input
            className={inputCls}
            value={profile.profileSubHeading}
            onChange={e =>
              setProfile(p => ({ ...p, profileSubHeading: e.target.value }))
            }
            placeholder="Secondary heading"
          />
        </div>
      </div>
    </Section>
  )
}
