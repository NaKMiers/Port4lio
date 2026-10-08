'use client'

import { Check, CloudOff, Copy, EyeOff, TriangleAlert, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import SelectField from '@/components/settings/SelectField'
import {
  inputCls,
  labelCls,
  primaryBtnCls,
} from '@/components/settings/settings-utils'
import { meaningStyle } from '@/components/whiteboard/meaning-style'
import type { Board } from '@/components/whiteboard/useBoard'
import { useReducedMotion } from '@/components/whiteboard/useTier'
import { useVocab } from '@/components/whiteboard/vocab-context'
import { cn } from '@/lib/utils'
import type { Meaning } from '@/lib/whiteboard/limits'
import type { ExportScope } from '@/lib/whiteboard/types'
import { buildExportPreview } from '@/lib/whiteboard/visible'

/**
 * Export to AI: a 480px NON-modal sheet over the inspector (DR3); below md it covers the whole
 * canvas, like the phone's inspector.
 *
 * ```
 *   board.data (every keystroke) ─┐
 *   board's agent switch ─────────┼─▶ buildExportPreview (visible.ts, in the browser) ─▶ preview
 *   scope (all / selection / ...) ┘        │
 *                                 { markdown, excludedCount, scopeHidden } (D25)
 * ```
 *
 * Non-modal on purpose: the canvas stays live, so the Selection scope follows whatever is
 * selected right now, and the preview follows every edit as it is typed - unsaved ones
 * included, which the "unsaved" notice says, because an agent reads the saved board.
 *
 * Built in the browser from the board already on screen: no request, no debounce, nothing to
 * fail. It is the same text an agent gets for the same saved board - `visible.ts` mirrors
 * `loadAgentVisible` and a parity test holds the two together (see its header). The notices
 * say what the privacy filter left out, so a pasted export is never silently missing cards.
 * Copy is disabled whenever there is nothing to copy.
 *
 * `useDeferredValue` is what keeps typing on a big board smooth: the render of up to 1 MB of
 * markdown happens at low priority, behind the keystroke that caused it.
 *
 * The preview shows that markdown RENDERED (`export-html.ts`, styled like the blog editor's
 * preview) rather than as source, because it is read to check what an agent will see.
 * Copy, and the manual-copy fallback, always carry the markdown itself.
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
  boardVisible,
  unsavedCount,
  selectionIds,
  initialScope,
  onClose,
  className,
}: {
  board: Board
  /** The board's own agent switch (D32), live from the switcher. */
  boardVisible: boolean
  /** Writes an agent cannot see yet: held (D31), failing, or refused. */
  unsavedCount: number
  selectionIds: string[]
  initialScope: 'all' | 'selection'
  onClose: () => void
  className?: string
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const reduced = useReducedMotion()
  const [scopeKey, setScopeKey] = useState<ScopeKey>(initialScope)
  const [meanings, setMeanings] = useState<Meaning[]>([])
  const { vocab } = useVocab()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
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

  const data = useDeferredValue(board.data)
  const result = useMemo(
    () =>
      buildExportPreview(
        {
          boardId: board.boardId,
          items: Object.values(data.items),
          links: Object.values(data.links),
          visible: boardVisible,
        },
        scope,
        vocab
      ),
    [board.boardId, boardVisible, data, scope, vocab]
  )
  // The deferred board lags a keystroke behind while it catches up.
  const stale = data !== board.data

  const markdown = result.markdown
  const empty = !markdown

  // The preview is the markdown rendered for reading (export-html.ts); Copy still copies the
  // markdown. The renderer is imported on first use, and a render that finishes after a newer
  // one started is dropped, so a slow keystroke can never overwrite a later one.
  const [rendered, setRendered] = useState<{
    markdown: string
    html: string | null
  } | null>(null)
  useEffect(() => {
    if (!markdown) return
    let cancelled = false
    import('@/components/whiteboard/export-html')
      .then(({ renderExportHtml }) => renderExportHtml(markdown))
      .then(html => {
        if (!cancelled) setRendered({ markdown, html })
      })
      .catch(() => {
        // A chunk that failed to load falls back to the plain text, never to nothing.
        if (!cancelled) setRendered({ markdown, html: null })
      })
    return () => {
      cancelled = true
    }
  }, [markdown])
  const rendering = stale || rendered?.markdown !== markdown
  const copyDisabled = empty

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
  if (result.scopeHidden)
    notice = (
      <Notice icon={<EyeOff size={14} />}>
        {boardVisible
          ? 'This frame is hidden from AI - nothing to export.'
          : 'This board is hidden from agents - nothing to export. Turn it on from the board name.'}
      </Notice>
    )
  else if (result.excludedCount > 0)
    notice = (
      <Notice icon={<EyeOff size={14} />}>
        {result.excludedCount} {scope.kind === 'selection' ? 'selected ' : ''}
        {result.excludedCount === 1 ? 'item is' : 'items are'} hidden
        {scope.kind === 'selection' ? '' : ' in this scope'} and not included.
      </Notice>
    )

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="wb-export-title"
      data-testid="wb-export-sheet"
      className={cn(
        // md-lg a bottom sheet over the canvas like the inspector, max 60dvh (DR8); from lg
        // the 480px right sheet over the inspector (DR3). Below md the whole canvas, header
        // to bottom edge, like the phone's inspector: a 60dvh sheet left a preview a few
        // lines tall. `top-12` is the top bar's one 48px row (TopBar).
        'absolute inset-x-0 bottom-0 z-30 flex max-h-[60dvh] flex-col rounded-t-[1.4rem] border-t border-pp-line bg-pp-panel-strong pb-[env(safe-area-inset-bottom)] shadow-[0_-24px_60px_rgba(46,35,28,0.1)]',
        'max-md:top-12 max-md:max-h-none max-md:rounded-none max-md:border-t-0 max-md:shadow-none',
        'lg:left-auto lg:top-12 lg:max-h-none lg:w-full lg:max-w-[480px] lg:rounded-none lg:border-l lg:border-t-0 lg:pb-0 lg:shadow-[-24px_0_60px_rgba(46,35,28,0.1)]',
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
              {vocab.meanings.map(({ key: meaning }) => {
                const on = meanings.includes(meaning)
                const style = meaningStyle(vocab, meaning)
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
        {unsavedCount > 0 && !empty ? (
          <Notice icon={<CloudOff size={14} />}>
            {unsavedCount} unsaved{' '}
            {unsavedCount === 1 ? 'change is' : 'changes are'} in this preview.
            Agents read the board once it is saved.
          </Notice>
        ) : null}
        {result.truncated ? (
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
        {empty ? (
          <p className="text-sm text-pp-muted">
            {result.scopeHidden
              ? boardVisible
                ? 'This frame is hidden from AI.'
                : 'This board is hidden from AI.'
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
          <PreviewBody
            html={rendered?.html}
            markdown={rendered?.markdown ?? markdown}
            first={rendered === null}
            rendering={rendering}
          />
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

function PreviewBody({
  html,
  markdown,
  first,
  rendering,
}: {
  /** `null` when the renderer failed to load: the markdown is shown as text instead. */
  html: string | null | undefined
  markdown: string
  /** Nothing has rendered yet, so there is nothing older to show meanwhile. */
  first: boolean
  rendering: boolean
}) {
  if (first)
    return (
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
    )
  const cls = cn(rendering && 'opacity-60')
  if (html === null)
    return (
      <pre
        data-testid="wb-export-preview"
        className={cn(
          'whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-pp-text',
          cls
        )}
      >
        {markdown}
      </pre>
    )
  return (
    <div
      data-testid="wb-export-preview"
      className={cn('blog-prose wb-export-prose', cls)}
      // Sanitized in export-html.ts: raw HTML dropped at remark-rehype, then rehype-sanitize.
      dangerouslySetInnerHTML={{ __html: html ?? '' }}
    />
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
