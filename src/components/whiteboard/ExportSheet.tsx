'use client'

import { Check, Copy, EyeOff, RotateCw, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import SelectField from '@/components/settings/SelectField'
import {
  inputCls,
  labelCls,
  primaryBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { MEANING_STYLE } from '@/components/whiteboard/meaning-style'
import type { Board } from '@/components/whiteboard/useBoard'
import { useReducedMotion } from '@/components/whiteboard/useTier'
import { cn } from '@/lib/utils'
import { MEANINGS, type Meaning } from '@/lib/whiteboard/limits'
import type { ContextResponse, ExportScope } from '@/lib/whiteboard/types'
import { getContextApi } from '@/requests/whiteboard'

/**
 * Export to AI: a 480px NON-modal sheet over the inspector (DR3).
 *
 * ```
 *   scope (all / selection / a frame / filter) ──400 ms──▶ POST /context ──▶ preview
 *                                                             │
 *                                  { markdown, excludedCount, scopeHidden } (D25)
 * ```
 *
 * Non-modal on purpose: the canvas stays live, so the Selection scope follows whatever is
 * selected right now. The preview is rendered by the SERVER through `loadAgentVisible`, the
 * same path `context.md` and MCP use, so what is copied here is exactly what an agent would
 * read - and the notices say what the privacy filter left out, so a pasted export is never
 * silently missing cards. Copy is disabled whenever there is nothing to copy.
 */

type ScopeKey = 'all' | 'selection' | 'filter' | `frame:${string}`

function estimateTokens(chars: number) {
  const tokens = Math.round(chars / 4)
  return tokens >= 1000
    ? `~${Math.round(tokens / 100) / 10}k tokens`
    : `~${tokens} tokens`
}

export default function ExportSheet({
  board,
  selectionIds,
  initialScope,
  onClose,
  className,
}: {
  board: Board
  selectionIds: string[]
  initialScope: 'all' | 'selection'
  onClose: () => void
  className?: string
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const reduced = useReducedMotion()
  const [scopeKey, setScopeKey] = useState<ScopeKey>(initialScope)
  const [meanings, setMeanings] = useState<Meaning[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [result, setResult] = useState<ContextResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [copied, setCopied] = useState(false)
  const [manualCopy, setManualCopy] = useState(false)

  useEffect(() => headingRef.current?.focus(), [])

  const frames = useMemo(
    () =>
      Object.values(board.data.items)
        .filter(item => item.form === 'frame')
        .sort((a, b) => a.y - b.y || a.x - b.x),
    [board.data.items]
  )

  const scope: ExportScope = useMemo(() => {
    if (scopeKey === 'selection')
      return { kind: 'selection', ids: selectionIds }
    if (scopeKey === 'filter')
      return {
        kind: 'filter',
        meanings,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }
    if (scopeKey.startsWith('frame:'))
      return { kind: 'frame', id: scopeKey.slice(6) }
    return { kind: 'all' }
  }, [from, meanings, scopeKey, selectionIds, to])
  const scopeJson = JSON.stringify(scope)

  // The preview follows every edit on the board too: `updatedAt` stamps change on save.
  const boardVersion = board.status.pending === 0 ? board.data : null

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setFailed(false)
      try {
        const next = await getContextApi(
          JSON.parse(scopeJson),
          controller.signal
        )
        setResult(next)
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true)
          setResult(null)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [scopeJson, nonce, boardVersion])

  const markdown = result?.markdown ?? ''
  const empty = !markdown
  const copyDisabled = loading || failed || empty

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard denied: fall back to a selectable textarea (DR4).
      setManualCopy(true)
    }
  }

  const options = [
    { value: 'all', label: 'Whole board' },
    { value: 'selection', label: `Selection (${selectionIds.length})` },
    ...frames.map(frame => ({
      value: `frame:${frame._id}`,
      label: `Frame: ${frame.title || 'Untitled frame'}${frame.includeInAi ? '' : ' (hidden)'}`,
    })),
    { value: 'filter', label: 'Filter by meaning or date' },
  ]

  let notice: React.ReactNode = null
  if (result?.scopeHidden)
    notice = (
      <Notice icon={<EyeOff size={14} />}>
        This frame is hidden from AI - nothing to export.
      </Notice>
    )
  else if (result && result.excludedCount > 0)
    notice = (
      <Notice icon={<EyeOff size={14} />}>
        {result.excludedCount}{' '}
        {scope.kind === 'selection' ? 'selected' : 'items in this scope'}{' '}
        {result.excludedCount === 1 ? 'item is' : 'items are'} hidden and not
        included.
      </Notice>
    )

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="wb-export-title"
      data-testid="wb-export-sheet"
      className={cn(
        // Below lg a bottom sheet over the canvas like the inspector, max 60dvh (DR8); from
        // lg the 480px right sheet over the inspector (DR3).
        'absolute inset-x-0 bottom-0 z-30 flex max-h-[60dvh] flex-col rounded-t-[1.4rem] border-t border-pp-line bg-pp-panel-strong pb-[env(safe-area-inset-bottom)] shadow-[0_-24px_60px_rgba(46,35,28,0.1)]',
        'lg:left-auto lg:top-14 lg:max-h-none lg:w-full lg:max-w-[480px] lg:rounded-none lg:border-l lg:border-t-0 lg:pb-0 lg:shadow-[-24px_0_60px_rgba(46,35,28,0.1)]',
        !reduced &&
          'animate-[wb-sheet-up_180ms_ease-out] lg:animate-[wb-sheet-in_180ms_ease-out]',
        className
      )}
    >
      <header className="flex items-center justify-between border-b border-pp-line px-5 py-3.5">
        <h2
          id="wb-export-title"
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-base font-semibold text-pp-text outline-none"
        >
          Export to AI
        </h2>
        <button
          type="button"
          aria-label="Close export (Esc)"
          onClick={onClose}
          className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-pp-muted hover:text-pp-text lg:h-8 lg:w-8"
        >
          <X size={18} />
        </button>
      </header>

      <div className="space-y-3 border-b border-pp-line px-5 py-4">
        <div>
          <label
            htmlFor="wb-export-scope"
            className={labelCls}
          >
            Scope
          </label>
          <SelectField
            id="wb-export-scope"
            value={scopeKey}
            options={options}
            onChange={value => setScopeKey(value as ScopeKey)}
          />
        </div>
        {scopeKey === 'filter' ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {MEANINGS.map(meaning => {
                const on = meanings.includes(meaning)
                const style = MEANING_STYLE[meaning]
                return (
                  <button
                    key={meaning}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setMeanings(prev =>
                        on
                          ? prev.filter(m => m !== meaning)
                          : [...prev, meaning]
                      )
                    }
                    className={cn(
                      'rounded-full border px-2.5 py-1 font-display text-[10.5px] font-semibold uppercase tracking-[0.1em]',
                      on ? style.chipCls : 'border-pp-line text-pp-muted'
                    )}
                  >
                    {style.label}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                aria-label="From (the card's date)"
                value={from}
                onChange={event => setFrom(event.target.value)}
                className={cn(inputCls, 'px-3 py-2')}
              />
              <input
                type="date"
                aria-label="To (inclusive)"
                value={to}
                onChange={event => setTo(event.target.value)}
                className={cn(inputCls, 'px-3 py-2')}
              />
            </div>
          </div>
        ) : null}
        {notice}
        {result?.truncated ? (
          <p className="flex items-start gap-2 text-[12px] text-pp-ink-amber">
            <TriangleAlert
              aria-hidden
              size={14}
              className="mt-0.5 shrink-0"
            />
            Truncated: {result.renderedCount} of {result.totalCount} items fit
            in 1 MB. Agents can reach the rest with search_context.
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading && !result ? (
          <div
            aria-label="Loading preview"
            className="space-y-2"
          >
            {[70, 90, 55, 80, 40].map((w, i) => (
              <div
                key={i}
                className="h-3 animate-pulse rounded bg-pp-text/10 motion-reduce:animate-none"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ) : failed ? (
          <div role="alert">
            <p className="text-sm font-semibold text-pp-ink-rose">
              Preview failed
            </p>
            <button
              type="button"
              onClick={() => setNonce(n => n + 1)}
              className={cn(secondaryBtnCls, 'mt-2 gap-2')}
            >
              <RotateCw size={13} />
              Retry
            </button>
          </div>
        ) : empty ? (
          <p className="text-sm text-pp-muted">
            {result?.scopeHidden
              ? 'This frame is hidden from AI.'
              : 'Nothing to export.'}
          </p>
        ) : manualCopy ? (
          <textarea
            readOnly
            autoFocus
            aria-label="Export markdown - select all and copy"
            value={markdown}
            onFocus={event => event.currentTarget.select()}
            className="h-full min-h-[300px] w-full resize-none rounded-xl border border-pp-line bg-white p-3 font-mono text-[11.5px]"
          />
        ) : (
          <pre
            data-testid="wb-export-preview"
            className={cn(
              'whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-pp-text',
              loading && 'opacity-60'
            )}
          >
            {markdown}
          </pre>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-pp-line px-5 py-3.5">
        <span className="text-[12px] text-pp-muted">
          {markdown ? estimateTokens(markdown.length) : ' '}
        </span>
        <button
          type="button"
          disabled={copyDisabled}
          onClick={copy}
          className={cn(primaryBtnCls, 'gap-2 px-4 py-2.5')}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? `Copied - ${estimateTokens(markdown.length)}` : 'Copy'}
        </button>
      </footer>
    </section>
  )
}

function Notice({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <p
      data-testid="wb-export-notice"
      className="flex items-start gap-2 rounded-xl border border-pp-line bg-pp-text/5 px-3 py-2 text-[12.5px] text-pp-text"
    >
      <span
        aria-hidden
        className="mt-0.5 text-pp-muted"
      >
        {icon}
      </span>
      {children}
    </p>
  )
}
