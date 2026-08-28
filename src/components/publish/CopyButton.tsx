'use client'

import { useEffect, useState } from 'react'

import { secondaryBtnCls } from '@/components/settings/settings-utils'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * The Clipboard API throws on non-secure origins and when the document is not focused.
 * Surfacing that is the point - silently showing "Copied" on a copy that did not happen
 * is exactly the sort of thing that makes you paste stale text into LinkedIn.
 */
export default function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <button
      type='button'
      className={secondaryBtnCls}
      onClick={() => void copy()}
      disabled={!value}
      title={state === 'failed' ? 'Clipboard blocked - select the text and copy manually' : undefined}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy blocked' : label}
    </button>
  )
}
