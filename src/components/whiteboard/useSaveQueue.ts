'use client'

import { useEffect, useState } from 'react'

import { SaveQueue, type QueueStatus } from '@/components/whiteboard/save-queue'
import { sendSaveOpApi } from '@/requests/whiteboard'

/**
 * The React side of the save queue: one `SaveQueue` per board, plus the browser signals it
 * needs.
 *
 * ```
 *   useBoard actions ──▶ queue.createItem / patchItem / bulkMove / deleteItem / ...
 *                              │           (ordering, debounce, deps, retry: save-queue.ts)
 *                              ▼
 *                        sendSaveOpApi ──▶ /api/admin/whiteboard/*
 *
 *   window 'offline' ──▶ queue.setOnline(false)   pill: "Offline - changes kept"
 *   window 'online'  ──▶ queue.setOnline(true)    everything waiting goes now
 *   beforeunload     ──▶ warn while anything is pending or rejected
 * ```
 *
 * ## Why the queue is a plain class, created once
 *
 * Its whole value is in rules that are easy to get subtly wrong - a child racing its frame, a
 * deleted card being recreated by a late retry - and those are tested in
 * `tests/unit/whiteboard-save-queue.test.ts` with a fake clock and a fake network. Keeping it
 * free of React is what makes that possible; this hook is only the wiring.
 *
 * ## Why `beforeunload` counts rejected edits too
 *
 * A 4xx is permanent - the queue has already let go of it - but the change is still only on
 * this canvas. Closing the tab would lose it exactly as surely as a pending write.
 */
export function useSaveQueue({ rejectedCount }: { rejectedCount: number }) {
  const [queue] = useState(() => new SaveQueue({ send: sendSaveOpApi }))

  const [status, setStatus] = useState<QueueStatus>(() => queue.status())

  useEffect(() => {
    const goOnline = () => queue.setOnline(true)
    const goOffline = () => queue.setOnline(false)
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      queue.setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [queue])

  const unsaved = status.pending > 0 || rejectedCount > 0
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Chrome still requires returnValue to be set for the prompt to show.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  return { queue, status, setStatus }
}
