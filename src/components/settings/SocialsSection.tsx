import React from 'react'

import type { Profile, SocialLink } from '@/types/profile'
import AddMoreButton from '@/components/settings/AddMoreButton'
import Section from '@/components/settings/Section'
import type { IconPickerTarget } from '@/components/settings/types'
import {
  emptyStateCls,
  ghostBtnCls,
  iconPreviewCls,
  inputCls,
  itemCardCls,
  labelCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { resolveIconFromCode } from '@/utils/iconResolver'

export default function SocialsSection({
  profile,
  setProfile,
  setIconPickerTarget,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  setIconPickerTarget: React.Dispatch<React.SetStateAction<IconPickerTarget>>
}) {
  const updateSocial = (idx: number, patch: Partial<SocialLink>) => {
    setProfile(p => {
      const next = [...p.socials]
      next[idx] = { ...next[idx], ...patch }
      return { ...p, socials: next }
    })
  }

  const addSocial = () =>
    setProfile(p => ({ ...p, socials: [...p.socials, { name: '', icon: '', link: '' }] }))

  return (
    <Section id='socials' title='Social Links' badge='icons + links'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <h2 className='text-sm font-semibold'>Socials</h2>
        <button
          type='button'
          className={secondaryBtnCls}
          onClick={addSocial}
        >
          + Add
        </button>
      </div>

      <div className='space-y-3'>
        {profile.socials.length === 0 ? <div className={emptyStateCls}>No socials yet.</div> : null}
        {profile.socials.map((s, idx) => (
          <div key={idx} className={itemCardCls}>
            <div className='grid grid-cols-1 gap-3'>
              <div className='space-y-2'>
                <label className={labelCls}>Display name</label>
                <input className={inputCls} value={s.name} onChange={e => updateSocial(idx, { name: e.target.value })} />
              </div>

              <div className='space-y-2'>
                <label className={labelCls}>Icon code</label>
                <div className='flex items-center gap-2'>
                  <button
                    type='button'
                    className={`${iconPreviewCls} transition hover:-translate-y-0.5 hover:border-pp-blue/35`}
                    onClick={() => setIconPickerTarget({ kind: 'social', socialIndex: idx })}
                    title='Pick icon'
                  >
                    {s.icon ? resolveIconFromCode(s.icon, 18) : null}
                  </button>
                  <input
                    className={inputCls}
                    value={s.icon}
                    onChange={e => updateSocial(idx, { icon: e.target.value })}
                    placeholder='e.g. fa:FaGithub'
                  />
                </div>
              </div>

              <div className='space-y-2'>
                <label className={labelCls}>Link</label>
                <input
                  className={inputCls}
                  value={s.link}
                  onChange={e => updateSocial(idx, { link: e.target.value })}
                  placeholder='https://...'
                />
              </div>

              <div className='flex justify-end'>
                <button
                  type='button'
                  className={ghostBtnCls}
                  onClick={() => setProfile(p => ({ ...p, socials: p.socials.filter((_, i) => i !== idx) }))}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
        {profile.socials.length > 0 ? (
          <AddMoreButton label='+ Add social link' onClick={addSocial} />
        ) : null}
      </div>
    </Section>
  )
}

