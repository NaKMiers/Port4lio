import React from 'react'

import type { Profile } from '@/types/profile'
import Section from '@/components/settings/Section'
import { labelCls, textareaCls } from '@/components/settings/settings-utils'

export default function AboutSection({
  profile,
  setProfile,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
}) {
  return (
    <Section id='about' title='About Me' badge='story'>
      <div className='space-y-2'>
        <label className={labelCls}>About Me</label>
        <textarea
          className={textareaCls}
          value={profile.aboutMe}
          onChange={e => setProfile(p => ({ ...p, aboutMe: e.target.value }))}
          placeholder='Write a short bio...'
          rows={10}
        />
      </div>
    </Section>
  )
}
