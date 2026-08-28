import React from 'react'

import Section from '@/components/settings/Section'
import {
  emptyStateCls,
  ghostBtnCls,
  helpTextCls,
  inputCls,
  itemCardCls,
  labelCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { replaceAt, resumeOf, updateResume } from '@/components/settings/resume-utils'
import type { Profile, ResumeContactLink } from '@/types/profile'

export default function ResumeMastheadSection({
  profile,
  setProfile,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
}) {
  const resume = resumeOf(profile)
  const { contact } = resume

  const updateLink = (idx: number, patch: Partial<ResumeContactLink>) => {
    updateResume(setProfile, r => ({
      ...r,
      contact: { ...r.contact, links: replaceAt(r.contact.links, idx, patch) },
    }))
  }

  return (
    <Section title='CV Masthead' badge='name, role, contact'>
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
          <div className='space-y-2 md:col-span-2'>
            <label className={labelCls}>Photo URL</label>
            <input
              className={inputCls}
              value={resume.photo}
              onChange={e => updateResume(setProfile, r => ({ ...r, photo: e.target.value }))}
            />
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
            onClick={() =>
              updateResume(setProfile, r => ({
                ...r,
                contact: { ...r.contact, links: [...r.contact.links, { label: '', text: '', href: '' }] },
              }))
            }
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
      </div>
    </Section>
  )
}
