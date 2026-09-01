import React from 'react'

import type { Profile } from '@/types/profile'
import AddMoreButton from '@/components/settings/AddMoreButton'
import ListTextarea, { linesToText, textToLines } from '@/components/settings/ListTextarea'
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
  textareaCls,
} from '@/components/settings/settings-utils'
import { resolveIconFromCode } from '@/utils/iconResolver'

export default function ServicesSection({
  profile,
  setProfile,
  setIconPickerTarget,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  setIconPickerTarget: React.Dispatch<React.SetStateAction<IconPickerTarget>>
}) {
  const addService = () =>
    setProfile(p => ({ ...p, services: [...p.services, { icon: '', title: '', description: '' }] }))

  return (
    <Section id='services' title='Services' badge='offerings' defaultOpen>
      <div className='space-y-5'>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <div className='space-y-2'>
            <label className={labelCls}>Service heading</label>
            <input
              className={inputCls}
              value={profile.serviceHeading}
              onChange={e => setProfile(p => ({ ...p, serviceHeading: e.target.value }))}
            />
          </div>
          <div className='space-y-2'>
            <label className={labelCls}>Service sub-heading</label>
            <input
              className={inputCls}
              value={profile.serviceSubHeading}
              onChange={e => setProfile(p => ({ ...p, serviceSubHeading: e.target.value }))}
            />
          </div>
        </div>

        <div className='space-y-2'>
          <label className={labelCls}>Brief Services (one per line)</label>
          <ListTextarea
            className={textareaCls}
            value={profile.briefServices}
            join={linesToText}
            parse={textToLines}
            onChange={briefServices => setProfile(p => ({ ...p, briefServices }))}
            placeholder={'e.g.\nWeb Design\nSEO Optimization\nAI Integration'}
          />
        </div>

        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <h2 className='text-sm font-semibold'>Services</h2>
            <button
              type='button'
              className={secondaryBtnCls}
              onClick={addService}
            >
              + Add
            </button>
          </div>

          {profile.services.length === 0 ? <div className={emptyStateCls}>No services yet.</div> : null}

          {profile.services.map((sv, idx) => (
            <div key={idx} className={itemCardCls}>
              <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                <div className='space-y-2'>
                  <label className={labelCls}>Icon code</label>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      className={`${iconPreviewCls} transition hover:-translate-y-0.5 hover:border-pp-blue/35`}
                      onClick={() => setIconPickerTarget({ kind: 'service', serviceIndex: idx })}
                      title='Pick icon'
                    >
                      {resolveIconFromCode(sv.icon, 18)}
                    </button>
                    <input
                      className={inputCls}
                      value={sv.icon}
                      onChange={e =>
                        setProfile(p => {
                          const next = [...p.services]
                          next[idx] = { ...next[idx], icon: e.target.value }
                          return { ...p, services: next }
                        })
                      }
                      placeholder='e.g. tb:TbBolt'
                    />
                  </div>
                </div>
                <div className='space-y-2'>
                  <label className={labelCls}>Title</label>
                  <input
                    className={inputCls}
                    value={sv.title}
                    onChange={e =>
                      setProfile(p => {
                        const next = [...p.services]
                        next[idx] = { ...next[idx], title: e.target.value }
                        return { ...p, services: next }
                      })
                    }
                  />
                </div>
                <div className='space-y-2 md:col-span-2'>
                  <label className={labelCls}>Description</label>
                  <textarea
                    className={textareaCls}
                    value={sv.description}
                    onChange={e =>
                      setProfile(p => {
                        const next = [...p.services]
                        next[idx] = { ...next[idx], description: e.target.value }
                        return { ...p, services: next }
                      })
                    }
                    placeholder='What this service includes...'
                  />
                </div>
              </div>
              <div className='mt-3 flex justify-end'>
                <button
                  type='button'
                  className={ghostBtnCls}
                  onClick={() => setProfile(p => ({ ...p, services: p.services.filter((_, i) => i !== idx) }))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {profile.services.length > 0 ? (
            <AddMoreButton label='+ Add service' onClick={addService} />
          ) : null}
        </div>
      </div>
    </Section>
  )
}

