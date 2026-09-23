'use client'

import dynamic from 'next/dynamic'

import Spinner from '@/components/settings/Spinner'

/**
 * Loads the canvas in the browser only. React Flow measures real DOM nodes, and the board is
 * private data fetched after the owner gate - there is nothing useful to render on the
 * server. `ssr: false` must sit in a client component in the App Router, hence this file.
 */
const WhiteboardApp = dynamic(
  () => import('@/components/whiteboard/WhiteboardApp'),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center rounded-panel border border-pp-line bg-[rgba(255,253,250,0.55)] text-pp-muted">
        <Spinner size={20} />
      </div>
    ),
  }
)

export default function WhiteboardClient({ boardId }: { boardId: string }) {
  return <WhiteboardApp boardId={boardId} />
}
