'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'portfolio:settings:open-sections'

type SectionOpenMap = Record<string, boolean>

type SectionOpenController = {
  /** Stored preference for this section, or `defaultOpen` if it has never been toggled. */
  isOpen: (id: string, defaultOpen: boolean) => boolean
  setOpen: (id: string, open: boolean) => void
}

const SectionOpenContext = createContext<SectionOpenController | null>(null)

function readStored(): SectionOpenMap {
  if (typeof window === 'undefined') return {}

  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? 'null'
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {}

    // Drop anything that is not a boolean rather than trusting the whole blob: this value
    // is user-writable and a stale shape should degrade to defaults, not throw.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'boolean'
      )
    ) as SectionOpenMap
  } catch {
    return {}
  }
}

/**
 * Remembers which editor sections are expanded.
 *
 * The sections are native `<details>` elements, so their open state lived in the DOM -
 * and every tab switch unmounts them, which meant reopening the same three panels after
 * each trip to another tab. Hoisting it here survives both the unmount and a reload,
 * while an id absent from the map still falls through to that section's own default, so
 * the first panel of each tab opens on a first visit.
 *
 * Reading `localStorage` in the initialiser is safe because `OwnerAuthGate` renders its
 * "Checking access..." card until an effect resolves, so this subtree never exists during
 * hydration and cannot mismatch the server's markup.
 */
export function SectionOpenProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [openMap, setOpenMap] = useState<SectionOpenMap>(readStored)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(openMap))
    } catch {
      // A full or blocked storage quota should cost the preference, nothing more.
    }
  }, [openMap])

  const controller: SectionOpenController = {
    isOpen: (id, defaultOpen) => (id in openMap ? openMap[id] : defaultOpen),
    setOpen: (id, open) =>
      setOpenMap(prev => {
        // Setting the attribute from state fires a native `toggle` event, which lands back
        // here with the value we just applied. Bailing out keeps that from looping.
        if (prev[id] === open) return prev
        return { ...prev, [id]: open }
      }),
  }

  return (
    <SectionOpenContext.Provider value={controller}>
      {children}
    </SectionOpenContext.Provider>
  )
}

/**
 * Falls back to plain uncontrolled behaviour outside a provider, so a `Section` rendered
 * somewhere else still works - it just does not remember.
 */
export function useSectionOpen(): SectionOpenController {
  return (
    useContext(SectionOpenContext) ?? {
      isOpen: (_id, defaultOpen) => defaultOpen,
      setOpen: () => {},
    }
  )
}
