import React from 'react'

import type { Profile } from '@/types/profile'
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
  nestedItemCardCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { resolveIconFromCode } from '@/utils/iconResolver'

export default function SkillsSection({
  profile,
  setProfile,
  setIconPickerTarget,
}: {
  profile: Profile
  setProfile: React.Dispatch<React.SetStateAction<Profile>>
  setIconPickerTarget: React.Dispatch<React.SetStateAction<IconPickerTarget>>
}) {
  const updateSkillGroup = (idx: number, patch: Partial<Profile['skills'][number]>) => {
    setProfile(p => {
      const next = [...p.skills]
      next[idx] = { ...next[idx], ...patch }
      return { ...p, skills: next }
    })
  }

  const addGroup = () => setProfile(p => ({ ...p, skills: [...p.skills, { groupName: '', items: [] }] }))

  const addItem = (gIdx: number) =>
    setProfile(p => {
      const next = [...p.skills]
      const cur = next[gIdx]
      next[gIdx] = { ...cur, items: [...cur.items, { icon: '', name: '' }] }
      return { ...p, skills: next }
    })

  return (
    <Section id='skills' title='Skills' badge='groups & items' defaultOpen>
      <div className='space-y-4'>
        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>Skill Groups</h2>
          <button
            type='button'
            className={secondaryBtnCls}
            onClick={addGroup}
          >
            + Add group
          </button>
        </div>

        {profile.skills.length === 0 ? <div className={emptyStateCls}>No skills yet.</div> : null}

        {profile.skills.map((group, gIdx) => (
          <div key={gIdx} className={itemCardCls}>
            <div className='grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end'>
              <div className='space-y-2'>
                <label className={labelCls}>Group name</label>
                <input
                  className={inputCls}
                  value={group.groupName}
                  onChange={e => updateSkillGroup(gIdx, { groupName: e.target.value })}
                  placeholder='e.g. Frontend'
                />
              </div>
              <div className='flex justify-end'>
                <button
                  type='button'
                  className={ghostBtnCls}
                  onClick={() => setProfile(p => ({ ...p, skills: p.skills.filter((_, i) => i !== gIdx) }))}
                >
                  Remove group
                </button>
              </div>
            </div>

            <div className='my-4 h-px bg-[linear-gradient(90deg,rgba(31,28,26,0.08),rgba(31,28,26,0.03),transparent)]' />

            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                <h3 className='text-sm font-semibold'>Items</h3>
                <button
                  type='button'
                  className={secondaryBtnCls}
                  onClick={() => addItem(gIdx)}
                >
                  + Add
                </button>
              </div>

              {group.items.length === 0 ? (
                <div className={emptyStateCls}>No items in this group.</div>
              ) : null}

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {group.items.map((it, iIdx) => (
                  <div key={iIdx} className={nestedItemCardCls}>
                    <div className='space-y-3'>
                      <div className='space-y-2'>
                        <label className={labelCls}>Icon code</label>
                        <div className='flex items-center gap-2'>
                          <button
                            type='button'
                            className={`${iconPreviewCls} transition hover:-translate-y-0.5 hover:border-pp-blue/35`}
                            onClick={() =>
                              setIconPickerTarget({ kind: 'skill', groupIndex: gIdx, itemIndex: iIdx })
                            }
                            title='Pick icon'
                          >
                            {resolveIconFromCode(it.icon, 18)}
                          </button>
                          <input
                            className={inputCls}
                            value={it.icon}
                            onChange={e => {
                              setProfile(p => {
                                const next = [...p.skills]
                                const cur = next[gIdx]
                                const nextItems = [...cur.items]
                                nextItems[iIdx] = { ...nextItems[iIdx], icon: e.target.value }
                                next[gIdx] = { ...cur, items: nextItems }
                                return { ...p, skills: next }
                              })
                            }}
                            placeholder='e.g. fa:FaReact'
                          />
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <label className={labelCls}>Name</label>
                        <input
                          className={inputCls}
                          value={it.name}
                          onChange={e => {
                            setProfile(p => {
                              const next = [...p.skills]
                              const cur = next[gIdx]
                              const nextItems = [...cur.items]
                              nextItems[iIdx] = { ...nextItems[iIdx], name: e.target.value }
                              next[gIdx] = { ...cur, items: nextItems }
                              return { ...p, skills: next }
                            })
                          }}
                          placeholder='e.g. TypeScript'
                        />
                      </div>
                    </div>
                    <div className='mt-3 flex justify-end'>
                      <button
                        type='button'
                        className={ghostBtnCls}
                        onClick={() => {
                          setProfile(p => {
                            const next = [...p.skills]
                            const cur = next[gIdx]
                            next[gIdx] = { ...cur, items: cur.items.filter((_, i) => i !== iIdx) }
                            return { ...p, skills: next }
                          })
                        }}
                      >
                        Remove item
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {group.items.length > 0 ? (
                <AddMoreButton label='+ Add item' onClick={() => addItem(gIdx)} />
              ) : null}
            </div>
          </div>
        ))}

        {profile.skills.length > 0 ? (
          <AddMoreButton label='+ Add skill group' onClick={addGroup} />
        ) : null}
      </div>
    </Section>
  )
}

