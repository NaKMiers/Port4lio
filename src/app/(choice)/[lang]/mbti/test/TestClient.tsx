'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import Chevron from '@/components/mbti/Chevron'
import type { Locale } from '@/lib/i18n'
import type { Answer } from '@/lib/mbti/scoring'

const cx = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ')

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

    if (next.length === questions.length) {
      void submit(next)
    }
  }

  if (submitting || !current) {
    return (
      <div className='flex min-h-[60vh] flex-col items-center justify-center gap-4 py-24'>
        <span
          className='h-3 w-3 rounded-full bg-[linear-gradient(135deg,var(--pp-violet),var(--pp-blue))] pp-pulse-soft'
          aria-hidden
        />
        <p
          className={cx('text-center text-lg', error ? 'text-[#c2410c]' : 'text-pp-muted')}
          role='status'
          aria-live='polite'
        >
          {error ?? copy.submitting}
        </p>
      </div>
    )
  }

  const answered = index
  const percent = Math.round((answered / questions.length) * 100)

  return (
    <div className='py-10 md:py-14'>
      <div className='flex items-baseline justify-between gap-4'>
        <p className='font-display text-xs font-semibold uppercase tracking-[0.18em] text-pp-muted'>
          {copy.questionProgress
            .replace('{current}', String(index + 1))
            .replace('{total}', String(questions.length))}
        </p>
        <p className='font-display text-xs font-semibold tabular-nums text-pp-muted'>{percent}%</p>
      </div>

      <div
        className='mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(31,28,26,0.07)]'
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={questions.length}
        aria-valuenow={answered}
      >
        <div
          className='h-full rounded-full bg-[linear-gradient(90deg,var(--pp-violet),var(--pp-blue))] transition-all duration-300'
          style={{ width: `${percent}%` }}
        />
      </div>

      <h1 className='mt-9 font-display text-[clamp(1.5rem,3.6vw,2.125rem)] font-semibold leading-snug tracking-tight text-pp-text'>
        {current.prompt}
      </h1>

      <div className='mt-8 space-y-3'>
        {(['a', 'b'] as const).map(key => (
          <button
            key={key}
            type='button'
            onClick={() => choose(key)}
            className='group flex w-full items-center gap-4 rounded-panel border border-pp-line bg-pp-panel px-5 py-4 text-left shadow-panel backdrop-blur-md transition hover:border-[rgba(123,109,255,0.45)] hover:bg-pp-panel-strong focus-visible:border-[rgba(123,109,255,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(123,109,255,0.35)] motion-safe:hover:-translate-y-0.5'
          >
            <span
              className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-pp-line bg-white/80 font-display text-xs font-semibold uppercase text-pp-muted transition group-hover:border-[rgba(123,109,255,0.4)] group-hover:text-pp-text'
              aria-hidden
            >
              {key}
            </span>
            <span className='text-base leading-relaxed text-pp-text md:text-lg'>{current[key]}</span>
          </button>
        ))}
      </div>

      {index > 0 && (
        <button
          type='button'
          onClick={() => setAnswers(answers.slice(0, -1))}
          className='mt-8 inline-flex items-center gap-2 text-sm font-semibold text-pp-muted transition hover:text-pp-text'
        >
          <Chevron direction='left' />
          {copy.back}
        </button>
      )}

      {error && (
        <p className='mt-6 text-sm text-[#c2410c]' role='alert'>
          {error}
        </p>
      )}
    </div>
  )
}
