'use client'

import { useSyncExternalStore } from 'react'

/**
 * The three layout tiers (DR8): `lg` >= 1024px is the approved framed layout, `md` moves the
 * inspector into a bottom sheet, `sm` also lays the tool rail along the top. Every tier has
 * every tool; the tier decides layout only. How a gesture behaves is `useCoarsePointer`'s job.
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

/**
 * A finger rather than a mouse, from the primary pointer. The canvas gestures follow this, not
 * the width: a tablet is a finger at md width, and a narrow desktop window is still a mouse.
 * Keying touch behaviour to `sm` used to give an iPad the mouse gestures - one finger drew a
 * selection box and nothing panned.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    onChange => {
      const query = window.matchMedia('(pointer: coarse)')
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false
  )
}
