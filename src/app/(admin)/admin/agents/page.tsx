import type { Metadata } from 'next'

import AgentsBoard from '@/components/agents/AgentsBoard'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'

export const metadata: Metadata = {
  title: 'Agents',
  robots: { index: false, follow: false },
}

/**
 * `/admin/agents` - MCP tokens, connect instructions and the agent activity feed.
 *
 * Same shape as `/admin/metrics`: `OwnerAuthGate` hides the UI, and
 * `/api/admin/agents/tokens` is what actually refuses a request without the owner cookie.
 * The gate here is convenience; the gate there is the control.
 */
export default function AgentsPage() {
  return (
    <div className="mx-auto w-full max-w-editorial px-gutter py-10">
      <OwnerAuthGate>
        <AgentsBoard />
      </OwnerAuthGate>
    </div>
  )
}
