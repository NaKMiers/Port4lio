'use client'

import { useSyncExternalStore } from 'react'

/**
 * The three layout tiers (DR8): `lg` >= 1024px is the approved framed layout, `md` keeps every
 * tool but moves the inspector into a bottom sheet, `sm` is view and edit only.
 */
export type Tier = 'lg' | 'md' | 'sm'

const LG = '(min-width: 1024px)'
const MD = '(min-width: 768px)'

function read(): Tier {
  if (window.matchMedia(LG).matches) return 'lg'
  if (window.matchMedia(MD).matches) return 'md'
  return 'sm'
}

function subscribe(onChange: () => void) {
  const queries = [window.matchMedia(LG), window.matchMedia(MD)]
  for (const query of queries) query.addEventListener('change', onChange)
  return () => {
    for (const query of queries) query.removeEventListener('change', onChange)
  }
}

export function useTier(): Tier {
  return useSyncExternalStore(subscribe, read, () => 'lg')
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    onChange => {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false
  )
}
