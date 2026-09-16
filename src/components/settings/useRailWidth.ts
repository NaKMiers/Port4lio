'use client'

import { useCallback, useEffect, useState } from 'react'

import type { SettingTabId } from '@/components/settings/types'

const STORAGE_KEY = 'portfolio:settings:rail-width'

/**
 * Starting width per tab, in px.
 *
 * The CV rail is wider because it renders real A4 sheets rather than a summary - at 380 the
 * printed page scales down far enough to stop being readable.
 */
export const DEFAULT_RAIL_WIDTH: Record<SettingTabId, number> = {
  profile: 380,
  career: 380,
  offering: 380,
  cv: 460,
}

export const MIN_RAIL_WIDTH = 280
export const MAX_RAIL_WIDTH = 960

/** How much of the editor column must survive, so the forms can never be crushed away. */
const MIN_EDITOR_WIDTH = 420

type RailWidthMap = Partial<Record<SettingTabId, number>>

function readStored(): RailWidthMap {
  if (typeof window === 'undefined') return {}

  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    // The value is user-writable, so anything that is not a finite number is dropped rather
    // than trusted - a stale shape should fall back to the default, not lay out at `NaN`.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, value]) => typeof value === 'number' && Number.isFinite(value)
      )
    ) as RailWidthMap
  } catch {
    return {}
  }
}

/**
 * Remembers how wide the preview rail is, per tab.
 *
 * Per tab rather than one shared number because the tabs want genuinely different things:
 * the CV tab is showing a page whose proportions matter, the others are showing a summary
 * that mostly wants to be out of the way. Sizing one of them used to resize all of them.
 */
export function useRailWidth(tab: SettingTabId) {
  const [widths, setWidths] = useState<RailWidthMap>(readStored)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // A blocked or full storage quota costs the preference, nothing more.
    }
  }, [widths])

  const width = widths[tab] ?? DEFAULT_RAIL_WIDTH[tab]

  /** Clamps against the container too, so widening cannot squeeze the forms out. */
  const setWidth = useCallback(
    (next: number, containerWidth?: number) => {
      const ceiling =
        containerWidth && containerWidth > 0
          ? Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, containerWidth - MIN_EDITOR_WIDTH))
          : MAX_RAIL_WIDTH

      const clamped = Math.round(Math.min(ceiling, Math.max(MIN_RAIL_WIDTH, next)))
      setWidths(prev => (prev[tab] === clamped ? prev : { ...prev, [tab]: clamped }))
    },
    [tab]
  )

  const resetWidth = useCallback(() => {
    setWidths(prev => {
      if (prev[tab] === undefined) return prev
      const next = { ...prev }
      delete next[tab]
      return next
    })
  }, [tab])

  return { width, setWidth, resetWidth, isDefault: widths[tab] === undefined }
}
