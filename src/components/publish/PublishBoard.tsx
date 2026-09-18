'use client'

import Link from 'next/link'
import { useEffect, useEffectEvent, useState } from 'react'

import PublishTargetCard from '@/components/publish/PublishTargetCard'
import SettingErrorBanner from '@/components/settings/SettingErrorBanner'
import SettingLoading from '@/components/settings/SettingLoading'
import TabNav from '@/components/settings/TabNav'
import { primaryBtnCls, secondaryBtnCls } from '@/components/settings/settings-utils'
import type { PublishManifestWithDrift, PublishTargetWithDrift } from '@/lib/publish/types'

export default function PublishBoard() {
  const [manifest, setManifest] = useState<PublishManifestWithDrift | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string>('github-readme')

  const load = async (blocking: boolean) => {
    try {
      if (blocking) setLoading(true)
      setError(null)
      const res = await fetch('/api/publish/manifest')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load publish manifest')
      setManifest(data as PublishManifestWithDrift)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load publish manifest')
    } finally {
      if (blocking) setLoading(false)
    }
  }

  const bootstrap = useEffectEvent(() => {
    void load(true)
  })

  // Deferred to a macrotask so the fetch's setState does not run inside the effect body,
  // matching how AppProvider bootstraps.
  useEffect(() => {
    const timer = window.setTimeout(() => bootstrap(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  /**
   * Sends the exact version this card is displaying, never a "latest" sentinel. If the
   * profile changed since load, the server records what was really pasted and the badge
   * immediately shows drift again.
   */
  const acknowledge = async (target: PublishTargetWithDrift) => {
    setAcknowledging(target.id)
    setError(null)
    try {
      const res = await fetch('/api/publish/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target.id, version: target.version, result: 'applied' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to record')
      await load(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record')
    } finally {
      setAcknowledging(null)
    }
  }

  // Said "Loading profile..." until SettingLoading took props. This board loads publish
  // state, not a profile, and had been telling the owner otherwise since it shipped.
  if (loading)
    return (
      <SettingLoading
        title='Loading publish state...'
        subtitle='Checking which targets are in sync with the current profile.'
      />
    )

  const targets = manifest ? manifest.targetOrder.map(id => manifest.targets[id]) : []
  const behind = targets.filter(target => !target.drift.inSync).length
  // Falls back to the first target so a refresh that drops a target cannot blank the page.
  const active = targets.find(target => target.id === activeId) ?? targets[0]

  return (
    <div className='space-y-6'>
      <div className='rounded-[2rem] border border-pp-line bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(255,250,246,0.78))] p-6 shadow-panel backdrop-blur-md sm:p-7'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
          <div className='max-w-3xl space-y-3'>
            <div className='flex flex-wrap items-center gap-2.5'>
              <span className='rounded-full border border-pp-line bg-white/82 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
                Publish
              </span>
              <span className='rounded-full bg-pp-text px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white'>
                {behind === 0 ? 'Everything in sync' : `${behind} of ${targets.length} out of date`}
              </span>
            </div>

            <div>
              <h1 className='font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl'>
                One profile, every platform.
              </h1>
              <p className='mt-3 max-w-2xl text-sm leading-relaxed text-pp-muted sm:text-base'>
                GitHub is updated automatically by a scheduled workflow. LinkedIn, Upwork and Fiverr
                publish no API for editing a profile, so those are copy-and-paste — press Mark as
                pasted once you have, and this page will tell you when they drift again.
              </p>
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2.5 lg:justify-end'>
            {/* The three owner surfaces reach each other from any of them. */}
            <Link className={secondaryBtnCls} href='/admin/metrics'>
              Metrics
            </Link>
            <Link className={secondaryBtnCls} href='/admin/settings'>
              Edit profile
            </Link>
            <button type='button' className={primaryBtnCls} onClick={() => void load(true)}>
              Refresh
            </button>
          </div>
        </div>
      </div>

      <SettingErrorBanner message={error} />

      {targets.length > 0 ? (
        <>
          <TabNav
            tabs={targets.map(target => ({
              id: target.id,
              label: target.label.replace(/^GitHub /, 'GH '),
              flagged: !target.drift.inSync,
            }))}
            activeId={active?.id ?? targets[0].id}
            onChange={setActiveId}
            ariaLabel='Publish targets'
          />

          {active ? (
            <PublishTargetCard
              target={active}
              acknowledging={acknowledging === active.id}
              onAcknowledge={t => void acknowledge(t)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
