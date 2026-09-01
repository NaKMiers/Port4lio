import React from 'react'

import type { Profile } from '@/types/profile'
import AddMoreButton from '@/components/settings/AddMoreButton'
import NumberField from '@/components/settings/NumberField'
import Section from '@/components/settings/Section'
import {
  emptyStateCls,
  ghostBtnCls,
  inputCls,
  itemCardCls,
  labelCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'

export default function StatsSection({
  profile,
  setProfile,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
}) {
  const updateStat = (idx: number, patch: Partial<Profile['stats'][number]>) => {
    setProfile(p => {
      const next = [...p.stats]
      next[idx] = { ...next[idx], ...patch }
      return { ...p, stats: next }
    })
  }

  const addStat = () => setProfile(p => ({ ...p, stats: [...p.stats, { label: '', value: 0 }] }))

  return (
    <Section id='stats' title='Stats' badge='hero counters'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <h2 className='text-sm font-semibold'>Stats</h2>
        <button
          type='button'
          className={secondaryBtnCls}
          onClick={addStat}
        >
          + Add
        </button>
      </div>

      <div className='space-y-3'>
        {profile.stats.length === 0 ? <div className={emptyStateCls}>No stats yet.</div> : null}
        {profile.stats.map((st, idx) => (
          <div key={idx} className={itemCardCls}>
            <div className='grid grid-cols-1 gap-3'>
              <div className='space-y-2'>
                <label className={labelCls}>Label</label>
                <input className={inputCls} value={st.label} onChange={e => updateStat(idx, { label: e.target.value })} />
              </div>
              <div className='space-y-2'>
                <label className={labelCls}>Value</label>
                <NumberField
                  className={inputCls}
                  value={st.value}
                  onChange={value => updateStat(idx, { value })}
                />
              </div>
              <div className='flex justify-end'>
                <button
                  type='button'
                  className={ghostBtnCls}
                  onClick={() => setProfile(p => ({ ...p, stats: p.stats.filter((_, i) => i !== idx) }))}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
        {profile.stats.length > 0 ? <AddMoreButton label='+ Add stat' onClick={addStat} /> : null}
      </div>
    </Section>
  )
}

