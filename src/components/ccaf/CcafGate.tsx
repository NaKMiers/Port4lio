'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import OwnerAuthGate from '@/components/settings/OwnerAuthGate'

/**
 * `OwnerAuthGate` for a page whose contents are server-rendered.
 *
 * `/settings` and `/metrics` fetch their data from an admin API after the gate
 * opens, so the gate on its own is enough for them. This page renders the plan on the
 * server, so it splits the job in two: the page withholds the state from a request with no
 * owner cookie, and the gate asks for one. That leaves a seam - verifying a code changes
 * what the server would send, but not what it already sent - and `router.refresh()` is the
 * stitch. Without it the gate would open onto the empty payload it was covering.
 */
export default function CcafGate({ children }: { children?: ReactNode }) {
  const router = useRouter()

  return (
    <OwnerAuthGate onAuthed={() => router.refresh()}>
      {children ?? (
        <div className="relative mx-auto max-w-editorial px-gutter py-10">
          <div className="rounded-panel border border-pp-line bg-pp-panel-strong p-6 text-sm font-medium text-pp-muted shadow-panel">
            Loading the plan...
          </div>
        </div>
      )}
    </OwnerAuthGate>
  )
}
