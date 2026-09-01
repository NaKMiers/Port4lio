'use client'

import React, { useEffect, useState } from 'react'

import { inputCls, labelCls, primaryBtnCls, secondaryBtnCls } from '@/components/settings/settings-utils'

export default function OwnerAuthGate({
  children,
  onAuthed,
}: {
  children: React.ReactNode
  /**
   * Fired once, after a code is verified in this session - not when the mount check finds
   * an existing cookie, where the caller's own data fetch has already succeeded.
   *
   * The settings editor needs it: its profile fetch ran before the cookie existed and
   * came back 401, so without a refetch here the gate would open onto a spinner.
   */
  onAuthed?: () => void
}) {
  const [checking, setChecking] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        setChecking(true)
        const res = await fetch('/api/auth/me')
        const data = await res.json()
        setAuthed(!!data?.ok)
      } catch {
        setAuthed(false)
      } finally {
        setChecking(false)
      }
    }
    void run()
  }, [])

  const requestCode = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const res = await fetch('/api/auth/request-code', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to request code')
      setStep('verify')
      setInfo('Code sent to owner email. Enter the 6-digit code.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request code')
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Verification failed')
      setAuthed(true)
      setInfo('Verified. Access granted for 24 hours.')
      onAuthed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className='portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text'>
        <div className='pointer-events-none absolute inset-0 pp-grid-wash opacity-60' />
        <div className='relative mx-auto max-w-xl px-gutter py-10'>
          <div className='rounded-[1.8rem] border border-pp-line bg-white/78 p-6 shadow-panel backdrop-blur-md'>
            <div className='text-sm font-medium text-pp-muted'>Checking access...</div>
          </div>
        </div>
      </div>
    )
  }

  if (authed) return <>{children}</>

  return (
    <div className='portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text'>
      <div className='pointer-events-none absolute inset-0 pp-grid-wash opacity-60' />
      <div className='relative mx-auto max-w-xl px-gutter py-10'>
        <div className='rounded-[1.9rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(255,250,246,0.76))] p-6 shadow-panel backdrop-blur-md'>
          <div className='rounded-full border border-pp-line bg-white/82 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
            Protected editor
          </div>
          <div className='mt-4 font-display text-3xl font-semibold tracking-tight text-pp-text'>
            Owner access required
          </div>
          <div className='mt-2 text-sm leading-relaxed text-pp-muted'>
            Request a login code. If verified, this browser will be allowed for 24 hours.
          </div>

          {error ? (
            <div className='mt-4 rounded-[1.15rem] border border-[rgba(163,49,47,0.16)] bg-[rgba(211,108,105,0.1)] px-3 py-2 text-sm text-[#7f2f2f]'>
              {error}
            </div>
          ) : null}
          {info ? (
            <div className='mt-4 rounded-[1.15rem] border border-[rgba(51,152,255,0.18)] bg-[rgba(51,152,255,0.08)] px-3 py-2 text-sm text-[#255f97]'>
              {info}
            </div>
          ) : null}

          <div className='mt-5 space-y-4'>
            {step === 'request' ? (
              <button type='button' className={primaryBtnCls} disabled={busy} onClick={requestCode}>
                {busy ? 'Sending...' : 'Send code to owner email'}
              </button>
            ) : (
              <>
                <div className='space-y-2'>
                  <label className={labelCls}>6-digit code</label>
                  <input
                    className={inputCls}
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder='123456'
                    inputMode='numeric'
                  />
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <button type='button' className={primaryBtnCls} disabled={busy} onClick={verifyCode}>
                    {busy ? 'Verifying...' : 'Verify'}
                  </button>
                  <button
                    type='button'
                    className={secondaryBtnCls}
                    disabled={busy}
                    onClick={() => {
                      setStep('request')
                      setCode('')
                      setError(null)
                      setInfo(null)
                    }}
                  >
                    Back
                  </button>
                  <button type='button' className={secondaryBtnCls} disabled={busy} onClick={requestCode}>
                    Resend code
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
