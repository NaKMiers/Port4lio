'use client'

import { Archive, Hash, RotateCw, Sparkles, Type } from 'lucide-react'

import {
  primaryBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { cn } from '@/lib/utils'

/**
 * The empty board (wireframe-empty.png) and the failed load (DR4).
 *
 * The empty state is left-aligned and says what the board is FOR before it says how to use
 * it: this is a context store an agent reads, so the privacy line is part of the welcome, not
 * a setting found later.
 *
 * "Add sample data" (D33) is offered last and quietly: an empty board is an invitation to
 * write one true thing, and a seeded board is a demo. It is here because the alternative to
 * seeing what meanings, frames, links and the privacy badge look like together is typing
 * fifteen cards.
 */
export function EmptyBoard({
  onText,
  onFrame,
  onMock,
  onRestore,
  className,
}: {
  onText: () => void
  onFrame: () => void
  /** "Add sample data" (D33): a board's worth of cards, links and a frame in one click. */
  onMock: () => void
  onRestore: () => void
  className?: string
}) {
  const kbd =
    'ml-1 rounded-md border border-current/30 px-1.5 font-display text-[10px] font-semibold opacity-70'
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-[5] grid place-items-center p-6',
        className
      )}
    >
      <div
        aria-hidden
        className="absolute left-[15%] top-[10%] hidden h-[120px] w-[220px] rounded-2xl border-[1.5px] border-dashed border-pp-text/15 md:block"
      />
      <div
        aria-hidden
        className="absolute bottom-[16%] right-[18%] hidden h-[150px] w-[260px] rounded-2xl border-[1.5px] border-dashed border-pp-text/15 md:block"
      />
      <div className="pointer-events-auto w-full max-w-[440px]">
        <p className="font-display text-[13px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
          Your context store
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-pp-text">
          Put down one true thing.
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-pp-muted">
          A goal, a failure, a dream. Give it a meaning and link it to what
          caused it. Agents read what you put here, so hide a frame for anything
          private.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onText}
            className={cn(primaryBtnCls, 'gap-2 px-5 py-2.5')}
          >
            <Type
              aria-hidden
              size={15}
            />
            Text card
            <span className={kbd}>T</span>
          </button>
          <button
            type="button"
            onClick={onFrame}
            className={cn(secondaryBtnCls, 'gap-2 px-4 py-2.5')}
          >
            <Hash
              aria-hidden
              size={14}
            />
            Frame
            <span className={kbd}>F</span>
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onMock}
            data-testid="wb-mock-empty"
            className="inline-flex items-center gap-2 px-4 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted hover:text-pp-text"
          >
            <Sparkles
              aria-hidden
              size={14}
            />
            Add sample data
          </button>
          <button
            type="button"
            onClick={onRestore}
            className="inline-flex items-center gap-2 px-4 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted hover:text-pp-text"
          >
            <Archive
              aria-hidden
              size={14}
            />
            Restore from backup
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The empty board behind a share link. The owner's version is about THEIR context store and
 * THEIR agents, and offers sample data and a backup restore - none of which is a visitor's.
 * An edit link keeps the two ways to start; a view link has nothing to offer but the fact.
 */
export function SharedEmptyBoard({
  onText,
  onFrame,
  className,
}: {
  /** Absent on a view link. */
  onText?: () => void
  onFrame?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-[5] grid place-items-center p-6',
        className
      )}
    >
      <div className="pointer-events-auto w-full max-w-[400px] text-center">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-pp-text">
          This board is empty.
        </h2>
        {onText && onFrame ? (
          <>
            <p className="mt-2 text-[15px] leading-relaxed text-pp-muted">
              Anyone with this link can add to it.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={onText}
                className={cn(primaryBtnCls, 'gap-2 px-5 py-2.5')}
              >
                <Type
                  aria-hidden
                  size={15}
                />
                Text card
              </button>
              <button
                type="button"
                onClick={onFrame}
                className={cn(secondaryBtnCls, 'gap-2 px-4 py-2.5')}
              >
                <Hash
                  aria-hidden
                  size={14}
                />
                Frame
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[15px] leading-relaxed text-pp-muted">
            Nothing has been put on it yet.
          </p>
        )}
      </div>
    </div>
  )
}

export function BoardLoadFailed({
  message,
  onRetry,
  className,
}: {
  message: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 z-[6] grid place-items-center p-6',
        className
      )}
    >
      <div
        role="alert"
        className="w-full max-w-sm rounded-[1.4rem] border border-pp-line bg-pp-panel-strong p-5 shadow-panel"
      >
        <h2 className="font-display text-lg font-semibold text-pp-text">
          {message}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-pp-muted">
          Nothing is editable until the whole board has loaded, so a partial
          board can never save over the real one.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className={cn(primaryBtnCls, 'mt-4 gap-2 py-2.5')}
        >
          <RotateCw
            aria-hidden
            size={15}
          />
          Retry
        </button>
      </div>
    </div>
  )
}
