'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { clientSessionId } from '@/lib/client-session'

import Chevron from '@/components/mbti/Chevron'
import type { Locale } from '@/lib/i18n'
import type { Answer } from '@/lib/mbti/scoring'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

/**
 * The question's typography, shared by the visible heading and the invisible sizers that
 * reserve its height. See the note at the render site - the two must not drift.
 */
const PROMPT_TYPE =
  'font-display text-[clamp(1.5rem,3.6vw,2.125rem)] font-semibold leading-snug tracking-tight text-pp-text'

type PresentedQuestion = {
  id: number
  prompt: string
  a: string
  b: string
}

/**
 * The questionnaire.
 *
 * One question on screen at a time, matching how these tests are normally taken on a
 * phone. Answers live in component state and are posted once at the end; there is no
 * per-answer request, so a slow connection costs one round trip rather than sixty.
 *
 * A refresh loses progress. That is a known, accepted gap for Phase 1 rather than an
 * oversight: persisting a draft means either a cookie (more stranger data, before consent
 * has been asked for) or a server-side draft row (writes before we know the test will be
 * finished). Both are worth doing when there is evidence people abandon partway; neither
 * is worth doing before that.
 */
export default function TestClient({
  locale,
  questions,
  copy,
}: {
  locale: Locale
  questions: PresentedQuestion[]
  copy: {
    /** `{current}` / `{total}` placeholders - see the note in `content/index.ts`. */
    questionProgress: string
    back: string
    submitting: string
    rateLimited: string
    genericError: string
  }
}) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Answer[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const index = answers.length
  const current = questions[index]

  /**
   * How far this session got, reported once on the way out.
   *
   * ```
   *   answers grow ──▶ furthestRef tracks the max
   *                          │
   *   visibilitychange / pagehide ──▶ sendBeacon ──▶ mbti:progress:<sessionId>  ($max)
   * ```
   *
   * The point is choosing the test's length and time limit from evidence rather than by
   * copying whoever we are modelling. That only works if abandonment is visible, and today
   * an abandoned test leaves no trace at all - `Attempt` is created at submit.
   *
   * Three details that are easy to get wrong and would each silently produce nothing:
   *
   * 1. `sendBeacon`, not `fetch`. A normal request issued during unload is cancelled.
   * 2. A typed `Blob`. `sendBeacon` sends `text/plain` from a string, and a route calling
   *    `request.json()` would reject it - which reads as "nobody abandoned the test".
   * 3. `visibilitychange`, not `beforeunload`. Mobile Safari and in-app WebViews often
   *    never fire `beforeunload`, and mobile is where these visitors are.
   *
   * Fires on every tab switch, so the server upserts with `$max` on one document per
   * session: repeats are free and cannot regress the furthest point reached.
   */
  const furthestRef = useRef(0)

  // Tracked in an effect, not during render: writing a ref while rendering is not safe
  // under concurrent React. `Math.max` because `back` decreases `index`, and the number
  // worth knowing is the furthest point reached, not the last one displayed.
  useEffect(() => {
    furthestRef.current = Math.max(furthestRef.current, index)
  }, [index])

  useEffect(() => {
    function report() {
      if (furthestRef.current <= 0) return
      const payload = JSON.stringify({
        product: 'mbti',
        kind: 'progress',
        sessionId: clientSessionId(),
        furthest: furthestRef.current,
        total: questions.length,
      })
      try {
        navigator.sendBeacon(
          '/api/event',
          new Blob([payload], { type: 'application/json' })
        )
      } catch {
        // A blocked or unavailable beacon costs one uncounted session. It must never
        // interfere with the test the visitor is in the middle of.
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') report()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', report)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', report)
    }
  }, [questions.length])

  async function submit(finalAnswers: Answer[]) {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/mbti/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: finalAnswers, locale }),
      })

      if (response.status === 429) {
        setError(copy.rateLimited)
        setSubmitting(false)
        return
      }

      if (!response.ok) {
        setError(copy.genericError)
        setSubmitting(false)
        return
      }

      const { token } = (await response.json()) as { token: string }
      router.push(`/${locale}/mbti/result/${token}`)
    } catch {
      setError(copy.genericError)
      setSubmitting(false)
    }
  }

  function choose(answer: Answer) {
    // Guard against a double-tap landing two answers on one question: once the last
    // answer is in and the request is in flight, further taps do nothing.
    if (submitting) return

    const next = [...answers, answer]
    setAnswers(next)

    if (next.length === questions.length) void submit(next)
  }

  if (submitting || !current)
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 py-24">
        <span
          className="pp-pulse-soft h-3 w-3 rounded-full bg-[linear-gradient(135deg,var(--pp-violet),var(--pp-blue))]"
          aria-hidden
        />
        <p
          className={cx(
            'text-center text-lg',
            error ? 'text-[#c2410c]' : 'text-pp-muted'
          )}
          role="status"
          aria-live="polite"
        >
          {error ?? copy.submitting}
        </p>
      </div>
    )

  const answered = index
  const percent = Math.round((answered / questions.length) * 100)

  return (
    <div className="py-10 md:py-14">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-pp-muted">
          {copy.questionProgress
            .replace('{current}', String(index + 1))
            .replace('{total}', String(questions.length))}
        </p>
        <p className="font-display text-xs font-semibold tabular-nums text-pp-muted">
          {percent}%
        </p>
      </div>

      <div
        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(31,28,26,0.07)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={questions.length}
        aria-valuenow={answered}
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--pp-violet),var(--pp-blue))] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/*
        The question sits in a slot as tall as the LONGEST question in the set, so the
        answers below it never move between questions.

        ```
          ┌─ grid, one cell ────────────┐
          │ h1        (visible, current)│  ← all 61 children share row 1 / col 1,
          │ div × 60  (invisible sizers)│    so the cell is as tall as the tallest
          └─────────────────────────────┘
                   answers start here    ← same y for all 60 questions
        ```

        Prompts run from 8 to 53 characters, which measures as one to three lines on a
        375px phone and one to two on a desktop - so the answer buttons were jumping by up
        to two line heights as someone worked through the test. That is a real cost, not a
        cosmetic one: a target that moves between taps is a target people mis-tap, and a
        mis-tap here is a wrong answer to a personality question with no way to tell.

        Sizing off hidden copies of every prompt rather than a hardcoded `min-height`:
        the reserved height is then whatever the real text actually needs at the current
        viewport, font and locale. A magic number would have to be re-measured by hand
        every time a question is reworded, a locale is added or the type scale moves - and
        when it drifts, nothing breaks loudly. It just starts jumping again.

        `invisible` is `visibility: hidden`, which keeps layout while removing the copies
        from the accessibility tree, from find-in-page and from text selection. `hidden`
        would collapse them and reserve nothing.

        `PROMPT_TYPE` is shared rather than repeated because the sizers only measure
        correctly while their typography matches the real heading exactly.

        The sizers are `div`s and must stay `div`s. `globals.css` styles
        `.portfolio-public-root p` with `font-weight: 400; line-height: 1.75`, and an
        element-plus-class selector outranks a Tailwind utility - so as `p` they silently
        measured at the wrong weight and leading, wrapped differently from the heading and
        reserved a height that matched nothing. `div` is not styled globally here.
      */}
      <div className="mt-9 grid">
        {questions.map(question => (
          <div
            key={question.id}
            aria-hidden
            className={cx(PROMPT_TYPE, 'invisible col-start-1 row-start-1')}
          >
            {question.prompt}
          </div>
        ))}
        <h1 className={cx(PROMPT_TYPE, 'col-start-1 row-start-1')}>
          {current.prompt}
        </h1>
      </div>

      <div className="mt-8 space-y-3">
        {(['a', 'b'] as const).map(key => (
          <button
            key={key}
            type="button"
            onClick={() => choose(key)}
            className="group flex w-full items-center gap-4 rounded-panel border border-pp-line bg-pp-panel px-5 py-4 text-left shadow-panel backdrop-blur-md transition hover:border-[rgba(123,109,255,0.45)] hover:bg-pp-panel-strong focus-visible:border-[rgba(123,109,255,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(123,109,255,0.35)] motion-safe:hover:-translate-y-0.5"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-pp-line bg-white/80 font-display text-xs font-semibold uppercase text-pp-muted transition group-hover:border-[rgba(123,109,255,0.4)] group-hover:text-pp-text"
              aria-hidden
            >
              {key}
            </span>
            <span className="text-base leading-relaxed text-pp-text md:text-lg">
              {current[key]}
            </span>
          </button>
        ))}
      </div>

      {index > 0 && (
        <button
          type="button"
          onClick={() => setAnswers(answers.slice(0, -1))}
          className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-pp-muted transition hover:text-pp-text"
        >
          <Chevron direction="left" />
          {copy.back}
        </button>
      )}

      {error && (
        <p
          className="mt-6 text-sm text-[#c2410c]"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  )
}
