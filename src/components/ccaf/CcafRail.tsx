import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import RichText from '@/components/ccaf/RichText'
import {
  BAND_DOT,
  BAND_TEXT,
  bandFor,
  chipCls,
  cx,
  domainAccentClass,
  domainAccentVar,
  fieldCls,
  fieldLabelCls,
  mutedMonoCls,
  primaryBtnCls,
  rangeCls,
} from '@/components/ccaf/ccaf-ui'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { t, UI } from '@/lib/ccaf/copy'
import {
  estimateScaledScore,
  MAX_CONFIDENCE,
  MOCK_QUESTION_COUNT,
  readinessPercent,
  type CcafMock,
  type CcafState,
} from '@/lib/ccaf/progress'
import { DOMAINS } from '@/lib/ccaf/roadmap'
import type { Locale } from '@/lib/i18n'

/**
 * The rail: how ready the five domains feel, and what the mock scores actually say.
 *
 * Those two things are shown next to each other on purpose. Self-rated confidence is the
 * number that decides what gets studied next, and mock percentages are the only check on
 * whether that rating is honest - the plan's own rule is to re-rate a domain whenever the
 * two disagree by much.
 */

/** Points of the exam a domain is still leaving on the table, at the current rating. */
function headroom(weight: number, level: number): number {
  return Math.round((weight * (MAX_CONFIDENCE - level)) / MAX_CONFIDENCE)
}

/**
 * The exam, split by weight, with the part already banked filled in.
 *
 * This replaces a per-row bar that paired each domain's weight against its rating. That
 * pairing had two problems: five weights spanning 15-27% are five near-identical bars, so
 * the mark carried nothing the number beside it did not; and it sat two pixels above a
 * slider, in the same visual grammar, while meaning something unrelated - the eye read
 * them as a pair that ought to agree.
 *
 * One strip instead. Segment widths are the real exam split, the solid part of each is
 * that domain's rating, and the solid parts sum to exactly the weighted total printed
 * beside it. The accent colours finally do a job: they key each segment to its row.
 */
function ReadinessStrip({ confidence }: { confidence: readonly number[] }) {
  return (
    <div className='flex h-2.5 gap-[3px]' role='presentation'>
      {DOMAINS.map((domain, i) => {
        const level = confidence[i] ?? 0
        return (
          <div
            key={domain.key}
            // Each block rounded on its own, with a real gap between: run them together
            // and the unfilled tail of one domain reads as the start of the next.
            className='relative overflow-hidden rounded-full bg-pp-line'
            style={{ flexGrow: domain.weight }}
          >
            <span
              className={cx(
                'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300',
                domainAccentClass(domain.key)
              )}
              style={{ width: `${(level / MAX_CONFIDENCE) * 100}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}

function DomainRow({
  index,
  locale,
  editable,
  level,
  allLevels,
  onChange,
}: {
  index: number
  locale: Locale
  editable: boolean
  level: number
  allLevels: readonly number[]
  onChange: (level: number) => void
}) {
  const domain = DOMAINS[index]
  if (!domain) return null

  const left = headroom(domain.weight, level)
  // The biggest remaining number is the answer to "what do I study next", so it is the one
  // mark that gets weight. Colouring every row's figure would say nothing, and colouring it
  // with an accent would collide with the five categorical hues already in play.
  const isBiggest =
    left > 0 &&
    left ===
      Math.max(...DOMAINS.map((d, i) => headroom(d.weight, allLevels[i] ?? 0)))

  return (
    <div className='border-t border-pp-line py-2.5 first:border-t-0 first:pt-0'>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='flex min-w-0 items-baseline gap-1.5'>
          <span
            className={cx(
              'h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full',
              domainAccentClass(domain.key)
            )}
            aria-hidden='true'
          />
          <span className='truncate text-[13px] font-semibold text-pp-text'>
            D{domain.key} · {domain.short}
          </span>
        </span>
        <span className={cx(mutedMonoCls, 'shrink-0 tabular-nums')}>
          {domain.weight}%
          {left > 0 ? (
            <>
              {' · '}
              <span
                className={cx(
                  isBiggest && 'font-semibold text-pp-text',
                  !isBiggest && 'text-pp-muted'
                )}
              >
                {t(UI.readinessLeft, locale)} {left}
              </span>
            </>
          ) : null}
        </span>
      </div>
      <div className='mt-1 flex items-center gap-3'>
        <input
          type='range'
          min={0}
          max={MAX_CONFIDENCE}
          step={1}
          value={level}
          disabled={!editable}
          onChange={event => onChange(Number(event.target.value))}
          aria-label={`${t(UI.confidenceOf, locale)} ${domain.short}`}
          aria-valuetext={`${level}/${MAX_CONFIDENCE}`}
          className={rangeCls}
          style={
            {
              '--fill': `${(level / MAX_CONFIDENCE) * 100}%`,
              '--accent': domainAccentVar(domain.key),
            } as React.CSSProperties
          }
        />
        <span
          className={cx(
            'w-9 shrink-0 text-right font-mono text-[11px] tabular-nums',
            level ? 'font-semibold text-pp-text' : 'text-pp-muted'
          )}
        >
          {level ? `${level}/${MAX_CONFIDENCE}` : '-'}
        </span>
      </div>
    </div>
  )
}

function MockForm({
  locale,
  onAdd,
  editable,
}: {
  locale: Locale
  onAdd: (mock: CcafMock) => void
  editable: boolean
}) {
  const [date, setDate] = useState('')
  const [label, setLabel] = useState('')
  const [correct, setCorrect] = useState('')
  const [percents, setPercents] = useState<string[]>(() =>
    DOMAINS.map(() => '')
  )
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = Number(correct)
    if (
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > MOCK_QUESTION_COUNT
    ) {
      setError(t(UI.mockRangeError, locale))
      return
    }
    setError(null)
    onAdd({
      // `crypto.randomUUID` is client-only here, and this component never renders on the
      // server - the id exists to key a list and to delete the right row, nothing more.
      id: crypto.randomUUID(),
      date: date || new Date().toISOString().slice(0, 10),
      label: label.trim() || t(UI.mockDefaultLabel, locale),
      correct: Math.round(parsed),
      domainPercents: percents.map(value => {
        if (value.trim() === '') return null
        const n = Number(value)
        return Number.isFinite(n)
          ? Math.min(100, Math.max(0, Math.round(n)))
          : null
      }),
    })
    setDate('')
    setLabel('')
    setCorrect('')
    setPercents(DOMAINS.map(() => ''))
  }

  return (
    <form onSubmit={submit} className='space-y-2.5'>
      <div className='grid grid-cols-2 gap-2'>
        <label className='space-y-1'>
          <span className={fieldLabelCls}>{t(UI.mockDate, locale)}</span>
          <input
            type='date'
            value={date}
            disabled={!editable}
            onChange={event => setDate(event.target.value)}
            className={fieldCls}
          />
        </label>
        <label className='space-y-1'>
          <span className={fieldLabelCls}>{t(UI.mockLabel, locale)}</span>
          <input
            type='text'
            value={label}
            maxLength={24}
            placeholder={t(UI.mockLabelPlaceholder, locale)}
            disabled={!editable}
            onChange={event => setLabel(event.target.value)}
            className={fieldCls}
          />
        </label>
      </div>
      <label className='block space-y-1'>
        <span className={fieldLabelCls}>{t(UI.mockCorrect, locale)}</span>
        <input
          type='number'
          min={0}
          max={MOCK_QUESTION_COUNT}
          value={correct}
          placeholder='48'
          disabled={!editable}
          onChange={event => setCorrect(event.target.value)}
          className={fieldCls}
        />
      </label>
      <div className='grid grid-cols-5 gap-1.5'>
        {DOMAINS.map((domain, i) => (
          <label key={domain.key} className='space-y-1'>
            <span className={cx(fieldLabelCls, 'tracking-normal')}>
              D{domain.key} %
            </span>
            <input
              type='number'
              min={0}
              max={100}
              value={percents[i] ?? ''}
              placeholder='-'
              disabled={!editable}
              onChange={event =>
                setPercents(current =>
                  current.map((value, index) =>
                    index === i ? event.target.value : value
                  )
                )
              }
              className={cx(fieldCls, 'px-1.5 text-center')}
            />
          </label>
        ))}
      </div>
      {error ? (
        <p
          role='alert'
          className='rounded-lg border border-red-200/80 bg-red-50/90 px-3 py-2 text-xs text-red-900'
        >
          {error}
        </p>
      ) : null}
      <button
        type='submit'
        disabled={!editable}
        className={cx(primaryBtnCls, 'w-full')}
      >
        {t(UI.mockSubmit, locale)}
      </button>
    </form>
  )
}

/**
 * One logged mock, and the two-step delete on it.
 *
 * ## Why the confirm is inline and not a modal
 *
 * A modal is the right tool when the consequence reaches past the thing you are looking
 * at. This one does not: it removes one row from a list of a handful, in a rail 20rem
 * wide. Dimming the whole page to ask about it would be louder than the action, and it
 * would take away the very thing the question is about - the score, the label and the date
 * that tell you whether this is the row you meant. Asking in place keeps them on screen.
 *
 * The `x` toggles rather than only opening, so the gesture that raised the question can
 * also dismiss it; `Escape` and `Keep` do the same, and focus moves to `Delete` so the
 * keyboard path is a real one. Nothing here guards against a mistaken confirm - the guard
 * is that the destructive button is now the second click and not the first.
 */
function MockCard({
  mock,
  locale,
  editable,
  onRemove,
}: {
  mock: CcafMock
  locale: Locale
  editable: boolean
  onRemove: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const confirmId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Without this the question appears and the keyboard is still on the `x`, so the answer
  // to it is two tabs away in a direction nothing indicates.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  const percent = Math.round((mock.correct / MOCK_QUESTION_COUNT) * 100)
  const band = bandFor(percent)

  return (
    <div
      className='rounded-xl border border-pp-line bg-pp-bg/50 px-3 py-2.5'
      onKeyDown={event => {
        if (!confirming || event.key !== 'Escape') return
        // Stopped so a future dialog or drawer around this rail does not also close on the
        // same keypress - this card asked the question, it should be what the key answers.
        event.stopPropagation()
        setConfirming(false)
      }}
    >
      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
        <span className='font-display text-lg font-semibold tabular-nums text-pp-text'>
          {mock.correct}
          <span className={mutedMonoCls}>/{MOCK_QUESTION_COUNT}</span>
        </span>
        <span
          className={cx(chipCls, 'px-2 py-0.5 text-[10px]', BAND_TEXT[band])}
        >
          <span
            className={cx('h-1.5 w-1.5 rounded-full', BAND_DOT[band])}
            aria-hidden='true'
          />
          {percent}%
        </span>
        <span className={cx(mutedMonoCls, 'mr-auto')}>
          ≈{estimateScaledScore(mock.correct)} · {mock.label}
        </span>
        {editable ? (
          <button
            type='button'
            onClick={() => setConfirming(current => !current)}
            aria-expanded={confirming}
            aria-controls={confirmId}
            aria-label={`${t(confirming ? UI.mockDeleteCancel : UI.mockDelete, locale)} ${mock.label}`}
            className={cx(
              'rounded-full p-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue',
              // Not rotated: a 45-degree turn on this glyph is a plus sign, which reads
              // as "add" at the exact moment the card is asking about a delete.
              confirming
                ? 'bg-pp-line text-pp-text'
                : 'text-pp-muted hover:bg-pp-line hover:text-pp-text'
            )}
          >
            <X className='h-3.5 w-3.5' aria-hidden='true' />
          </button>
        ) : null}
      </div>

      <div className='mt-1.5 flex flex-wrap gap-1'>
        {mock.domainPercents.map((value, i) => {
          const domain = DOMAINS[i]
          if (!domain || value === null) return null
          const domainBand = bandFor(value)
          return (
            <span
              key={domain.key}
              className={cx(
                chipCls,
                'px-2 py-0.5 text-[10px]',
                BAND_TEXT[domainBand]
              )}
            >
              D{domain.key} {value}%
            </span>
          )
        })}
      </div>

      {confirming ? (
        <div
          id={confirmId}
          role='group'
          aria-label={t(UI.mockDeleteConfirm, locale)}
          className='mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200/80 bg-red-50/90 px-2.5 py-2'
        >
          <span className='mr-auto text-xs font-semibold text-red-900'>
            {t(UI.mockDeleteConfirm, locale)}
          </span>
          <button
            ref={confirmRef}
            type='button'
            onClick={() => onRemove(mock.id)}
            className='inline-flex min-h-[30px] items-center rounded-full bg-red-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700'
          >
            {t(UI.mockDelete, locale)}
          </button>
          <button
            type='button'
            onClick={() => setConfirming(false)}
            className='inline-flex min-h-[30px] items-center rounded-full border border-pp-line bg-pp-panel-strong px-3 text-[11px] font-semibold text-pp-text transition-colors hover:border-pp-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
          >
            {t(UI.mockDeleteCancel, locale)}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function CcafRail({
  state,
  locale,
  editable,
  onConfidenceChange,
  onAddMock,
  onRemoveMock,
}: {
  state: CcafState
  locale: Locale
  editable: boolean
  onConfidenceChange: (index: number, level: number) => void
  onAddMock: (mock: CcafMock) => void
  onRemoveMock: (id: string) => void
}) {
  const readiness = readinessPercent(state.confidence)
  const mocks = [...state.mocks].sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <>
      <EditorialPanel variant='strong' className='p-5'>
        <h3 className='font-display text-base font-semibold tracking-tight text-pp-text'>
          {t(UI.readinessTitle, locale)}
        </h3>

        {/*
          The total sits with the strip that produces it rather than under a rule at the
          far end of five rows: the filled segments literally add up to this number, and
          separating them made it look like an unrelated verdict.
        */}
        <div className='mt-3 rounded-xl border border-pp-line bg-pp-bg/50 px-3.5 py-3'>
          <div className='flex items-baseline justify-between gap-3'>
            <span className='font-display text-[2rem] font-semibold leading-none tabular-nums text-pp-text'>
              {readiness === null ? '-' : `${readiness}%`}
            </span>
            <span className='text-right text-[11px] leading-tight text-pp-muted'>
              {t(UI.readinessTotal, locale)}
            </span>
          </div>
          <div className='mt-2.5'>
            <ReadinessStrip confidence={state.confidence} />
          </div>
        </div>

        <p className='mt-3 text-xs leading-relaxed text-pp-muted'>
          <RichText>{t(UI.readinessHelp, locale)}</RichText>
        </p>

        <div className='mt-3'>
          {DOMAINS.map((domain, i) => (
            <DomainRow
              key={domain.key}
              index={i}
              locale={locale}
              editable={editable}
              level={state.confidence[i] ?? 0}
              allLevels={state.confidence}
              onChange={level => onConfidenceChange(i, level)}
            />
          ))}
        </div>
      </EditorialPanel>

      <EditorialPanel variant='strong' className='p-5'>
        <h3 className='font-display text-base font-semibold tracking-tight text-pp-text'>
          {t(UI.mocksTitle, locale)}
        </h3>
        <p className='mt-1 text-xs leading-relaxed text-pp-muted'>
          <RichText>{t(UI.mocksHelp, locale)}</RichText>
        </p>

        <div className='mt-3'>
          <MockForm locale={locale} onAdd={onAddMock} editable={editable} />
        </div>

        <div className='mt-4 space-y-2'>
          {mocks.length === 0 ? (
            <p className='rounded-lg border border-dashed border-pp-line px-3 py-4 text-center text-xs text-pp-muted'>
              {t(UI.mockEmpty, locale)}
            </p>
          ) : (
            mocks.map(mock => (
              <MockCard
                key={mock.id}
                mock={mock}
                locale={locale}
                editable={editable}
                onRemove={onRemoveMock}
              />
            ))
          )}
        </div>
      </EditorialPanel>
    </>
  )
}
