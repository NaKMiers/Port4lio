'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clientSessionId } from '@/lib/client-session'
import type { Locale } from '@/lib/i18n'
import { fill } from '@/lib/iq/content'

type Question = {
  matrix: string
  options: string[]
  /**
   * Intrinsic width-to-height ratio of the question body.
   *
   * On the wire because the client cannot infer it. Generator v1 had a single square layout,
   * so the box below was `aspect-square` and that was correct. v2 also emits three-cell
   * sequences at roughly 4.5:1, and a square box letterboxes those into a thin strip with
   * large dead bands - eight of the twenty-six questions, all in the back half.
   */
  aspect: number
}

export type IqTestCopy = {
  questionProgress: string
  timeLeft: string
  skip: string
  back: string
  submitting: string
  timeUp: string
  rateLimited: string
  genericError: string
}

/**
 * The timed test.
 *
 * ```
 *   mount ──▶ POST /api/iq/start ──▶ { token, startedAt, durationSeconds }
 *                                         │
 *                    answer / skip / back │  countdown mirrors SERVER startedAt
 *                                         ▼
 *              last answer OR clock hits 0 ──▶ POST /api/iq/submit ──▶ /iq/result/<token>
 * ```
 *
 * ## The countdown is a display, not the clock
 *
 * `startedAt` comes from the server and the deadline is computed from it, so reloading,
 * sleeping the laptop, or editing anything in the console changes what is shown and not
 * what is enforced. `/api/iq/submit` re-checks against the same `startedAt` and refuses a
 * late submission. That is what makes two people's scores comparable.
 *
 * ## Items arrive rendered
 *
 * The server sends SVG strings, never the item spec. Sending the spec would mean sending
 * enough to recompute the answer, which is the one thing the generated-item design exists
 * to prevent.
 *
 * ## Why `dangerouslySetInnerHTML` is correct here, and DOMPurify is not
 *
 * These strings are machine-generated SVG from `lib/iq/items/render.ts`, and no value in
 * them originates from a request. Every interpolation in that module and in
 * `primitives.ts` is one of three things: a module constant (`INK`, `CELL`,
 * `STROKE_WIDTH`), a computed number passed through `.toFixed(2)` or `Math.cos`, or an
 * enum member from the generator's own vocabulary. The only external input to the whole
 * pipeline is a seed - an integer minted server-side by `/api/iq/start` and never echoed
 * back to the client.
 *
 * Running this through an HTML sanitizer would strip SVG elements it does not recognise
 * (breaking `clipPath`, which several items depend on) while defending against a vector
 * that does not exist. The protection here is that the input space is numbers and enums,
 * not that the output gets scrubbed afterwards.
 *
 * If that ever stops being true - if any user-supplied string reaches a render function -
 * this decision has to be revisited, and the comment above the render module says so too.
 */
export default function IqTestClient({
  locale,
  copy,
}: {
  locale: Locale
  copy: IqTestCopy
}) {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [deadline, setDeadline] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startedRef = useRef(false)
  const submittedRef = useRef(false)

  /**
   * Mirrors `answers` for the callbacks that must not re-subscribe on every keystroke:
   * the countdown's auto-submit, and the unload beacon. Updated in an effect rather than
   * during render, because writing a ref while rendering is not safe under concurrent
   * React.
   */
  const answersRef = useRef(answers)
  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  // Start the clock exactly once. StrictMode double-invokes effects in development, and a
  // second start would issue a second attempt and silently orphan the first.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    void fetch('/api/iq/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
      .then(response =>
        response.ok
          ? response.json()
          : Promise.reject(new Error('start failed'))
      )
      .then(
        (data: {
          token: string
          startedAt: string
          durationSeconds: number
          questions: Question[]
        }) => {
          setToken(data.token)
          setQuestions(data.questions)
          setAnswers(data.questions.map(() => -1))
          // Deadline from the SERVER's startedAt, not from when this response arrived, so
          // a slow round trip does not silently hand out extra time.
          setDeadline(
            new Date(data.startedAt).getTime() + data.durationSeconds * 1000
          )
        }
      )
      .catch(() => setError(copy.genericError))
  }, [locale, copy.genericError])

  const submit = useCallback(
    async (finalAnswers: number[]) => {
      if (submittedRef.current || !token) return
      submittedRef.current = true
      setSubmitting(true)

      try {
        const response = await fetch('/api/iq/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, answers: finalAnswers }),
        })

        if (response.status === 429) {
          setError(copy.rateLimited)
          submittedRef.current = false
          setSubmitting(false)
          return
        }
        if (!response.ok && response.status !== 403) {
          setError(copy.genericError)
          submittedRef.current = false
          setSubmitting(false)
          return
        }

        // A 403 means the clock expired. The result page still shows what was scored, so
        // sending them there beats stranding them on an error after 24 minutes of work.
        router.push(`/${locale}/iq/result/${token}`)
      } catch {
        setError(copy.genericError)
        submittedRef.current = false
        setSubmitting(false)
      }
    },
    [copy.genericError, copy.rateLimited, locale, router, token]
  )

  // Tick the display and auto-submit at zero.
  useEffect(() => {
    if (deadline === null) return

    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0) void submit(answersRef.current)
    }

    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [deadline, submit])

  // Abandonment, same shape as the MBTI beacon: one batched report on the way out, sent
  // with sendBeacon so it survives unload, as a typed Blob so `request.json()` can parse it.
  const furthestRef = useRef(0)
  useEffect(() => {
    furthestRef.current = Math.max(furthestRef.current, index)
  }, [index])

  useEffect(() => {
    function report() {
      if (submittedRef.current || furthestRef.current <= 0) return
      const payload = JSON.stringify({
        product: 'iq',
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
        // One uncounted session. Never interferes with the test in progress.
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

  const choose = useCallback(
    (option: number) => {
      if (submitting) return
      const next = [...answersRef.current]
      next[index] = option
      setAnswers(next)
      if (index + 1 < questions.length) setIndex(index + 1)
      else void submit(next)
    },
    [index, questions.length, submit, submitting]
  )

  const clock = useMemo(() => {
    if (remaining === null) return '--:--'
    const minutes = Math.floor(remaining / 60)
    const seconds = remaining % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }, [remaining])

  const question = questions[index]
  const lowTime = remaining !== null && remaining <= 120

  if (error)
    return (
      <div className="mx-auto max-w-2xl px-gutter py-16 text-center">
        <p className="text-pp-muted">{error}</p>
      </div>
    )

  if (!question || !token)
    return (
      <div className="mx-auto max-w-2xl px-gutter py-16 text-center">
        <p className="text-pp-muted">{copy.submitting}</p>
      </div>
    )

  return (
    <div className="mx-auto max-w-6xl px-gutter py-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-pp-muted">
          {fill(copy.questionProgress, {
            current: index + 1,
            total: questions.length,
          })}
        </p>
        <p
          className={`font-display text-sm font-semibold tabular-nums ${lowTime ? 'text-[#c2410c]' : 'text-pp-muted'}`}
          // Announced only as it gets urgent; a per-second live region would be unusable.
          aria-live={lowTime ? 'polite' : 'off'}
        >
          {copy.timeLeft} {clock}
        </p>
      </div>

      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[rgba(31,28,26,0.08)]"
        role="progressbar"
        aria-valuenow={index + 1}
        aria-valuemin={1}
        aria-valuemax={questions.length}
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--pp-violet),var(--pp-blue))] transition-[width]"
          style={{ width: `${((index + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/*
        Matrix left, options right on desktop; stacked on mobile.
        ```
          ┌──────────────┐  ┌────┬────┬────┐
          │   3x3 with   │  │ 1  │ 2  │ 3  │
          │   the  ?     │  ├────┼────┼────┤
          └──────────────┘  │ 4  │ 5  │ 6  │
                            └────┴────┴────┘
        ```
        Side by side matters because solving these means looking back and forth between
        the pattern and the candidates. Stacked, the options sit below the fold on a
        laptop and every comparison costs a scroll.

        Below `lg` it stacks, because two columns on a phone would shrink the matrix to
        the point where a half-shaded cell is indistinguishable from a filled one - and
        shading is load-bearing in several rules.
      */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start lg:gap-7">
        {/*
          Height-capped, not width-capped, and the cap lives on the WRAPPER rather than on
          the SVG inside it - otherwise the white card stretches to the full grid column and
          a square matrix sits in a visibly wider box with dead space either side.

          14rem of reserve, measured rather than guessed. On a 1280x720 laptop the chrome
          that has to stay on screen is header 65 + page padding 48 + progress 37 + the
          back/skip row 44 = 194px; 14rem is 224, and the spare 30px is slack so a longer
          locale string cannot push the controls out of view.
          ```
            ┌ header ─────────────┐  65
            │ progress            │  37
            │ ▓▓ matrix ▓▓        │  496  ← whatever the reserve leaves
            │ back / skip         │  44
            └─────────────────────┘
              footer                 below the fold, deliberately
          ```
          The footer is what the reserve does NOT include, and that is what made the square
          bigger: it was 19rem, sized to keep the site footer on screen as well, and holding
          85px for a privacy link cost the matrix 80px on every one of 26 questions. Nobody
          answering a matrix needs the footer in view - they need the options in view, and
          those are still above the fold.

          `svh` rather than `vh` because mobile browsers report `vh` against the viewport
          WITHOUT their collapsing toolbar, so `vh` overshoots by the height of that bar and
          reintroduces a real scroll on exactly the devices with least room.
        */}
        {/*
          The box takes its shape from the question, not from a constant.

          `maxWidth` still reserves vertical room the same way, but it has to be divided by
          the aspect: the reserve is a HEIGHT budget, and for a wide sequence the width that
          fits inside that height is proportionally larger. Using the height budget directly
          as a width cap would shrink a 4.5:1 sequence to a fifth of the space it could use.
        */}
        <div
          className="mx-auto w-full rounded-2xl border border-pp-line bg-white p-3 md:p-5"
          style={{
            maxWidth: `min(100%, calc((100svh - 14rem) * ${question.aspect}))`,
          }}
        >
          {/*
            The ratio is on the CONTENT box, not the padded one.

            Padding is uniform, so on a square it cancels and either position works - which is
            why v1 got away with `aspect-square` on the outer box. On a 4.36:1 sequence it does
            not cancel: 20px of padding each side leaves a content area at 5.5:1, and the SVG's
            `xMidYMid meet` then centres a 4.36:1 drawing inside it with dead space either
            side. Putting the ratio here makes the drawing fill the box it was measured for.
          */}
          <div
            className="w-full [&>svg]:h-full [&>svg]:w-full"
            style={{ aspectRatio: String(question.aspect) }}
            dangerouslySetInnerHTML={{ __html: question.matrix }}
          />
        </div>

        {/*
          Wider column than before (22rem, was 17rem) so each option is a bigger target -
          roughly 112px instead of 91px on desktop. The page itself is `max-w-6xl` rather
          than `5xl` for the same reason the cap moved: on a 1080p screen the matrix was
          width-limited, not height-limited, so the extra 128px goes straight into it. These are the only things on the page
          that get clicked, and several rules hinge on telling a half-shaded cell from a
          filled one, which is exactly the distinction that dies at small sizes.
        */}
        <div
          className="grid grid-cols-3 gap-3.5 lg:sticky lg:top-24"
          role="group"
          aria-label={fill(copy.questionProgress, {
            current: index + 1,
            total: questions.length,
          })}
        >
          {question.options.map((option, optionIndex) => (
            <button
              key={optionIndex}
              type="button"
              disabled={submitting}
              onClick={() => choose(optionIndex)}
              aria-label={`${optionIndex + 1}`}
              className="aspect-square rounded-xl border border-pp-line bg-white p-2.5 transition hover:-translate-y-0.5 hover:border-pp-blue focus-visible:border-pp-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pp-blue/40 disabled:opacity-50 motion-reduce:hover:translate-y-0"
            >
              <span
                className="block h-full w-full [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: option }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 text-sm">
        <button
          type="button"
          onClick={() => setIndex(Math.max(0, index - 1))}
          disabled={index === 0 || submitting}
          className="text-pp-muted underline underline-offset-[0.2em] disabled:opacity-40"
        >
          {copy.back}
        </button>
        <button
          type="button"
          onClick={() => choose(-1)}
          disabled={submitting}
          className="text-pp-muted underline underline-offset-[0.2em] disabled:opacity-40"
        >
          {copy.skip}
        </button>
      </div>

      {submitting ? (
        <p className="mt-6 text-center text-sm text-pp-muted">
          {copy.submitting}
        </p>
      ) : null}
    </div>
  )
}
