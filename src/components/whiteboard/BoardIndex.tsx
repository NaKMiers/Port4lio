'use client'

import { EyeOff, Plus, Sparkles, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import ConfirmDialog from '@/components/admin/ConfirmDialog'
import ToggleSwitch from '@/components/blog-admin/ToggleSwitch'
import Spinner from '@/components/settings/Spinner'
import {
  inputCls,
  primaryBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { useBoards } from '@/components/whiteboard/useBoards'
import type { ClientBoard } from '@/lib/whiteboard/data'
import { cn } from '@/lib/utils'

/**
 * `/admin/whiteboard` - the boards (D32).
 *
 * ```
 *   ┌ 2026 planning ──────────┐ ┌ Scratch ────────────────┐ ┌ + New board ┐
 *   │ 24 items                │ │ 3 items       EyeOff    │ └─────────────┘
 *   │ Agents can read  [ON ]  │ │ Agents can read  [off]  │
 *   │ rename in place    Trash│ │                    Trash│
 *   └─────────────────────────┘ └─────────────────────────┘
 * ```
 *
 * ## Why the AI switch and the delete are here and not in the canvas
 *
 * Both are about a board rather than about anything on it, and both are rare and
 * consequential - "nothing on this board reaches an agent" and "all of this is gone". The
 * canvas is where fifty small reversible edits a minute happen; putting either of these in
 * the top bar next to them makes a slip cheap. The switcher says which boards are hidden so
 * the state is never invisible, but changing it is a trip to this page.
 *
 * A board delete is the one destructive act on the whiteboard that undo cannot answer for -
 * the history lives in the canvas and dies with it - so this is also the one place that
 * still asks first, and asks with the item count in the question.
 */
export default function BoardIndex() {
  const { boards, loading, error, create, rename, setIncludeInAi, remove } =
    useBoards()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [doomed, setDoomed] = useState<ClientBoard | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const onCreate = async () => {
    setCreating(true)
    setFailed(null)
    try {
      const board = await create('New board')
      router.push(`/admin/whiteboard/${board._id}`)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not create the board.')
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-editorial px-gutter py-10">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
          Owner
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl">
          Whiteboards
        </h1>
        <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-pp-muted">
          One canvas per context. Agents read every board whose switch is on,
          and nothing at all from the ones that are off.
        </p>
      </header>

      {error ? (
        <p className="mt-8 rounded-panel border border-pp-ink-rose/30 bg-pp-pink/10 px-4 py-3 text-[13px] text-pp-ink-rose">
          {error}
        </p>
      ) : null}
      {failed ? (
        <p className="mt-8 text-[13px] text-pp-ink-rose">{failed}</p>
      ) : null}

      {loading ? (
        <div className="mt-10 grid place-items-center py-16 text-pp-muted">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {boards.map(board => (
            <BoardCard
              key={board._id}
              board={board}
              onRename={title => rename(board._id, title)}
              onIncludeInAi={on => setIncludeInAi(board._id, on)}
              onDelete={() => setDoomed(board)}
              soleBoard={boards.length === 1}
            />
          ))}

          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-pp-line bg-white/50 p-6 text-[13px] font-semibold text-pp-muted transition hover:border-pp-text/30 hover:text-pp-text disabled:opacity-60"
          >
            {creating ? <Spinner size={18} /> : <Plus size={18} />}
            New board
          </button>
        </div>
      )}

      <ConfirmDialog
        open={doomed !== null}
        busy={busy}
        title={`Delete "${doomed?.title || 'Untitled board'}"?`}
        message={
          <p>
            {doomed?.items
              ? `Its ${doomed.items} item${doomed.items === 1 ? '' : 's'} and every link between them go with it. `
              : 'It is empty. '}
            This is permanent, and undo on the canvas cannot bring a board back.
            Download its backup first if you might want it.
          </p>
        }
        confirmLabel="Delete board"
        onConfirm={async () => {
          if (!doomed) return
          setBusy(true)
          try {
            await remove(doomed._id)
            setDoomed(null)
          } catch (e) {
            setFailed(e instanceof Error ? e.message : 'Could not delete it.')
            setDoomed(null)
          } finally {
            setBusy(false)
          }
        }}
        onCancel={() => setDoomed(null)}
      />
    </div>
  )
}

function BoardCard({
  board,
  onRename,
  onIncludeInAi,
  onDelete,
  soleBoard,
}: {
  board: ClientBoard
  onRename: (title: string) => Promise<void>
  onIncludeInAi: (on: boolean) => Promise<void>
  onDelete: () => void
  soleBoard: boolean
}) {
  const [title, setTitle] = useState(board.title)
  const [saving, setSaving] = useState(false)

  return (
    <div className="flex flex-col rounded-panel border border-pp-line bg-pp-panel p-6 shadow-panel backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <input
          value={title}
          aria-label="Board name"
          placeholder="Untitled board"
          maxLength={200}
          onChange={event => setTitle(event.target.value)}
          onBlur={async () => {
            if (title === board.title) return
            setSaving(true)
            await onRename(title).catch(() => setTitle(board.title))
            setSaving(false)
          }}
          className={cn(inputCls, 'font-display text-lg font-semibold')}
        />
        {saving ? <Spinner size={14} /> : null}
      </div>

      <p className="mt-2 flex items-center gap-2 text-[13px] text-pp-muted">
        {board.items} item{board.items === 1 ? '' : 's'}
        {board.includeInAi ? null : (
          <span className="inline-flex items-center gap-1">
            <EyeOff
              aria-hidden
              size={12}
            />
            hidden from agents
          </span>
        )}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-pp-line bg-white/80 px-3.5 py-3">
        <div>
          <p
            id={`wb-board-ai-${board._id}-label`}
            className="text-[13px] font-semibold text-pp-text"
          >
            Agents can read this board
          </p>
          <p className="text-[11.5px] text-pp-muted">
            {board.includeInAi
              ? 'Its cards follow their own privacy switches.'
              : 'Nothing on it reaches an export or an MCP call.'}
          </p>
        </div>
        <ToggleSwitch
          id={`wb-board-ai-${board._id}`}
          checked={board.includeInAi}
          onChange={on => void onIncludeInAi(on)}
        />
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Link
          href={`/admin/whiteboard/${board._id}`}
          className={cn(primaryBtnCls, 'gap-2 px-4 py-2 no-underline')}
        >
          <Sparkles
            aria-hidden
            size={14}
          />
          Open
        </Link>
        <button
          type="button"
          onClick={onDelete}
          disabled={soleBoard}
          title={soleBoard ? 'This is your only board.' : 'Delete this board'}
          className={cn(
            secondaryBtnCls,
            'gap-2 px-3 py-2 text-pp-ink-rose disabled:cursor-not-allowed disabled:opacity-40'
          )}
        >
          <Trash2
            aria-hidden
            size={14}
          />
          Delete
        </button>
      </div>
    </div>
  )
}
