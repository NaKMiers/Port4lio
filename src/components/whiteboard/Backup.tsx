'use client'

import { Archive, ChevronDown, Download, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import ConfirmDialog from '@/components/admin/ConfirmDialog'
import Spinner from '@/components/settings/Spinner'
import {
  RESTORE_MAX_BODY_BYTES,
  validateBackupFile,
} from '@/lib/whiteboard/limits'
import { cn } from '@/lib/utils'
import { getBackupApi, restoreBatchApi } from '@/requests/whiteboard'

/**
 * Backup and restore - the way back from a hard delete (D20, D21).
 *
 * ```
 *   Download ──▶ GET /backup (streamed) ──▶ whiteboard-backup-YYYY-MM-DD.json
 *
 *   Restore: pick file ──▶ validateBackupFile (whole file, same validators as the routes)
 *              │ bad ──▶ "items[12]: title must be a single line." - nothing sent
 *              ▼
 *            batches of <= ~2 MB: frames, then items, then links
 *              ▼
 *            dry run each ──▶ "N items, M links, K already exist" ──▶ confirm (+ overwrite)
 *              ▼
 *            real run, "Batch 3 of 5" ──▶ stopped? "Stopped at 3/5 - Run again"
 * ```
 *
 * Batches upsert by `_id`, so running again after a failure converges instead of
 * duplicating (D21). Frames go first so a child's parent already exists when its batch
 * lands; links go last so both ends do.
 */

export const BATCH_BYTES = RESTORE_MAX_BODY_BYTES - 64 * 1024

interface Batch {
  items: unknown[]
  links: unknown[]
}

export function planBatches(file: {
  items: { form?: unknown }[]
  links: unknown[]
}): Batch[] {
  const encoder = new TextEncoder()
  const ordered: { kind: 'items' | 'links'; entry: unknown }[] = [
    ...file.items
      .filter(i => i.form === 'frame')
      .map(entry => ({ kind: 'items' as const, entry })),
    ...file.items
      .filter(i => i.form !== 'frame')
      .map(entry => ({ kind: 'items' as const, entry })),
    ...file.links.map(entry => ({ kind: 'links' as const, entry })),
  ]
  const batches: Batch[] = []
  let current: Batch = { items: [], links: [] }
  let size = 64
  for (const { kind, entry } of ordered) {
    const bytes = encoder.encode(JSON.stringify(entry)).length + 1
    if (
      size + bytes > BATCH_BYTES &&
      current.items.length + current.links.length
    ) {
      batches.push(current)
      current = { items: [], links: [] }
      size = 64
    }
    current[kind].push(entry)
    size += bytes
  }
  if (current.items.length + current.links.length) batches.push(current)
  return batches
}

type Phase =
  | { step: 'checking' }
  | { step: 'invalid'; error: string }
  | { step: 'preview'; items: number; links: number; existing: number }
  | { step: 'running'; batch: number; of: number }
  | { step: 'stopped'; at: number; of: number; error: string }
  | { step: 'done'; written: number }

export function RestoreDialog({
  file,
  pendingSaves,
  onClose,
  onRestored,
}: {
  file: File
  pendingSaves: number
  onClose: () => void
  onRestored: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ step: 'checking' })
  const [overwrite, setOverwrite] = useState(false)
  const batches = useRef<Batch[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const parsed = JSON.parse(await file.text())
        const checked = validateBackupFile(parsed)
        if (!checked.ok) {
          if (!cancelled) setPhase({ step: 'invalid', error: checked.error })
          return
        }
        batches.current = planBatches(parsed)
        let existing = 0
        for (const batch of batches.current) {
          const result = await restoreBatchApi({
            dryRun: true,
            overwrite: false,
            ...batch,
          })
          existing += result.existing
        }
        if (!cancelled)
          setPhase({
            step: 'preview',
            items: checked.items.length,
            links: checked.links.length,
            existing,
          })
      } catch (error) {
        if (!cancelled)
          setPhase({
            step: 'invalid',
            error:
              error instanceof SyntaxError
                ? 'The file is not valid JSON.'
                : error instanceof Error
                  ? error.message
                  : 'Could not read the file.',
          })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  const run = async () => {
    const all = batches.current
    let written = 0
    for (const [index, batch] of all.entries()) {
      setPhase({ step: 'running', batch: index + 1, of: all.length })
      try {
        const result = await restoreBatchApi({
          dryRun: false,
          overwrite,
          ...batch,
        })
        written += result.written
      } catch (error) {
        setPhase({
          step: 'stopped',
          at: index + 1,
          of: all.length,
          error: error instanceof Error ? error.message : 'Request failed',
        })
        return
      }
    }
    setPhase({ step: 'done', written })
    onRestored()
  }

  const title =
    phase.step === 'done'
      ? 'Restored'
      : phase.step === 'invalid'
        ? 'This backup cannot be restored'
        : 'Restore from backup'

  let message: React.ReactNode
  switch (phase.step) {
    case 'checking':
      message = (
        <p className="flex items-center gap-2">
          <Spinner size={14} /> Checking file...
        </p>
      )
      break
    case 'invalid':
      message = <p>{phase.error} Nothing was written.</p>
      break
    case 'preview':
      message = (
        <>
          <p>
            {phase.items} items, {phase.links} links, {phase.existing} already
            exist.
          </p>
          <label className="mt-3 flex items-center gap-2 text-pp-text">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={event => setOverwrite(event.target.checked)}
              className="h-4 w-4 accent-pp-text"
            />
            Overwrite the ones that already exist
          </label>
          {pendingSaves > 0 ? (
            <p className="mt-2 text-pp-ink-amber">
              Waiting for {pendingSaves} change{pendingSaves === 1 ? '' : 's'}{' '}
              to save first.
            </p>
          ) : null}
        </>
      )
      break
    case 'running':
      message = (
        <p className="flex items-center gap-2">
          <Spinner size={14} /> Batch {phase.batch} of {phase.of}
        </p>
      )
      break
    case 'stopped':
      message = (
        <p>
          Stopped at {phase.at}/{phase.of}: {phase.error}. Running it again is
          safe - batches that landed are skipped.
        </p>
      )
      break
    case 'done':
      message = (
        <p>{phase.written} documents written. The board has reloaded.</p>
      )
      break
  }

  return (
    <ConfirmDialog
      open
      title={title}
      message={message}
      destructive={false}
      busy={phase.step === 'checking' || phase.step === 'running'}
      confirmLabel={
        phase.step === 'stopped'
          ? 'Run again'
          : phase.step === 'preview'
            ? 'Restore'
            : 'Close'
      }
      onConfirm={() => {
        if (phase.step === 'preview' && pendingSaves === 0) void run()
        else if (phase.step === 'stopped') void run()
        else if (phase.step !== 'preview') onClose()
      }}
      onCancel={onClose}
    />
  )
}

export function BackupMenu({
  open,
  onToggle,
  onRestore,
  beforeDownload,
  compact,
}: {
  open: boolean
  onToggle: (open: boolean) => void
  onRestore: () => void
  beforeDownload: () => void
  compact: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as HTMLElement))
        onToggle(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onToggle, open])

  const download = async () => {
    setBusy(true)
    setError(null)
    beforeDownload()
    try {
      const blob = await getBackupApi()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `whiteboard-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      onToggle(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  const item =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] text-pp-text hover:bg-pp-text/5'

  return (
    <div
      ref={rootRef}
      className="relative"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Backup"
        onClick={() => onToggle(!open)}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-pp-line bg-white/85 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-text sm:px-3.5"
      >
        <Archive
          aria-hidden
          size={14}
        />
        <span className={cn(compact && 'sr-only')}>Backup</span>
        <ChevronDown
          aria-hidden
          size={12}
          className={cn(compact && 'hidden')}
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-64 rounded-2xl border border-pp-line bg-pp-panel-strong p-1.5 shadow-panel"
        >
          <button
            type="button"
            role="menuitem"
            onClick={download}
            disabled={busy}
            className={item}
          >
            {busy ? <Spinner size={14} /> : <Download size={14} />}
            Download backup (JSON)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggle(false)
              onRestore()
            }}
            className={item}
          >
            <Upload size={14} />
            Restore from backup
          </button>
          {error ? (
            <p className="px-3 py-1.5 text-[12px] text-pp-ink-rose">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
