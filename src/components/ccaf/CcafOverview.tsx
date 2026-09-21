import CcafLocaleSwitcher from '@/components/ccaf/CcafLocaleSwitcher'
import type { SaveStatus } from '@/components/ccaf/CcafTracker'
import RichText from '@/components/ccaf/RichText'
import {
  cx,
  eyebrowCls,
  fieldCls,
  mutedMonoCls,
} from '@/components/ccaf/ccaf-ui'
import { useHasMounted } from '@/components/ccaf/use-mounted'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives'
import { t, UI } from '@/lib/ccaf/copy'
import {
  COMPANY_DEADLINE,
  daysUntil,
  PASS_SCALED_SCORE,
  readinessPercent,
  TARGET_SCALED_SCORE,
  type CcafState,
  type Progress,
} from '@/lib/ccaf/progress'
import type { Locale } from '@/lib/i18n'

/**
 * The masthead: what the exam is, when it is, and how far along the plan is.
 *
 * ## Why the countdowns render empty on the server
 *
 * "Days left" depends on today, and today differs between the machine that rendered the
 * HTML and the machine reading it - by a whole day either side of midnight, and by more
 * than that once a cached page is involved. Rendering a dash until mount is the same trick
 * `AnimatedCounter` uses: one honest frame instead of a hydration mismatch, or worse, a
 * confidently wrong number baked into a 60-second cache.
 */

const STATUS_KEY: Record<SaveStatus, keyof typeof UI> = {
  idle: 'statusIdle',
  saving: 'statusSaving',
  saved: 'statusSaved',
  error: 'statusError',
  readonly: 'statusReadonly',
}

const STATUS_DOT: Record<SaveStatus, string> = {
  idle: 'bg-pp-muted/50',
  saving: 'bg-pp-orange',
  saved: 'bg-pp-green',
  error: 'bg-pp-pink',
  readonly: 'bg-pp-muted/50',
}

function Tile({
  label,
  value,
  hint,
  children,
}: {
  label: string
  value?: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 rounded-panel border border-pp-line bg-pp-panel-strong px-4 py-3 shadow-[0_12px_40px_rgba(46,35,28,0.06)] sm:px-5 sm:py-4">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-pp-muted">
        {label}
      </span>
      {value ? (
        <span className="font-display text-2xl font-semibold tracking-tight text-pp-text">
          {value}
        </span>
      ) : null}
      {children}
      {hint ? (
        <span className="text-xs leading-snug text-pp-muted">{hint}</span>
      ) : null}
    </div>
  )
}

export default function CcafOverview({
  state,
  locale,
  progress,
  editable,
  status,
  onExamDateChange,
}: {
  state: CcafState
  locale: Locale
  progress: Progress
  editable: boolean
  status: SaveStatus
  onExamDateChange: (value: string) => void
}) {
  // See `use-mounted.ts`: today belongs to the reader's clock, not the renderer's.
  const today = useHasMounted() ? new Date() : null

  const readiness = readinessPercent(state.confidence)
  const toExam = today ? daysUntil(today, state.examDate) : null
  const toDeadline = today ? daysUntil(today, COMPANY_DEADLINE) : null

  const countdown = (days: number | null) => {
    if (days === null) return '-'
    if (days > 0) return `${days} ${t(UI.daysSuffix, locale)}`
    return days === 0 ? t(UI.today, locale) : t(UI.past, locale)
  }

  return (
    <SectionFrame
      id="ccaf-overview"
      aria-labelledby="ccaf-overview-heading"
      className="scroll-mt-24 border-b border-pp-line pb-8 pt-8 md:scroll-mt-28 md:pb-12 md:pt-10"
    >
      <div className="space-y-6 md:space-y-8">
        <div className="flex items-start justify-between gap-4">
          <header className="max-w-3xl space-y-3">
            <p className={eyebrowCls}>{t(UI.eyebrow, locale)}</p>
            <h1
              id="ccaf-overview-heading"
              className="text-pretty font-display text-[clamp(2rem,4.6vw,3.1rem)] font-semibold leading-[1.08] tracking-tight text-pp-text"
            >
              {t(UI.pageTitle, locale)}
            </h1>
            <p className="text-pretty text-base leading-[1.75] text-pp-muted md:text-[1.0625rem]">
              {t(UI.ledeBefore, locale)}
              <strong className="font-semibold text-pp-text">
                ≥ {TARGET_SCALED_SCORE}/1000
              </strong>
              {t(UI.ledeAfter, locale)}
            </p>
          </header>
          <div className="shrink-0 pt-1">
            <CcafLocaleSwitcher current={locale} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          <Tile
            label={t(UI.tileGoal, locale)}
            value={`≥ ${TARGET_SCALED_SCORE}`}
            hint={t(UI.tileGoalHint, locale).replace(
              '720',
              String(PASS_SCALED_SCORE)
            )}
          />
          <Tile
            label={t(UI.tileExamDate, locale)}
            hint={
              toExam === null
                ? t(UI.tileExamDateHintPlain, locale)
                : `${countdown(toExam)} ${t(UI.tileExamDateHintSuffix, locale)}`
            }
          >
            <input
              type="date"
              value={state.examDate}
              disabled={!editable}
              onChange={event => onExamDateChange(event.target.value)}
              aria-label={t(UI.tileExamDate, locale)}
              className={cx(
                fieldCls,
                'mt-0.5 font-display text-lg font-semibold'
              )}
            />
          </Tile>
          <Tile
            label={t(UI.tileDeadline, locale)}
            value={countdown(toDeadline)}
            hint={t(UI.tileDeadlineHint, locale)}
          />
          <Tile
            label={t(UI.tileProgress, locale)}
            value={`${progress.percent}%`}
            hint={`${progress.done}/${progress.total} ${t(UI.tasksSuffix, locale)}`}
          >
            <div
              className="h-1.5 overflow-hidden rounded-full bg-pp-line"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-pp-text transition-[width] duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </Tile>
          <Tile
            label={t(UI.tileReadiness, locale)}
            value={readiness === null ? '-' : `${readiness}%`}
            hint={t(UI.tileReadinessHint, locale)}
          />
          <Tile label={t(UI.tileStatus, locale)}>
            <span className="inline-flex items-center gap-2 font-display text-lg font-semibold text-pp-text">
              <span
                className={cx(
                  'h-2 w-2 shrink-0 rounded-full',
                  STATUS_DOT[status]
                )}
                aria-hidden="true"
              />
              {t(UI[STATUS_KEY[status]], locale)}
            </span>
            <span className={mutedMonoCls}>
              {status === 'readonly'
                ? t(UI.tileStatusHintGuest, locale)
                : t(UI.tileStatusHintOwner, locale)}
            </span>
          </Tile>
        </div>

        <EditorialPanel
          variant="strong"
          className="p-5 sm:p-6"
        >
          <p className="text-sm leading-relaxed text-pp-muted">
            <strong className="font-semibold text-pp-text">
              {t(UI.howToReadLabel, locale)}
            </strong>{' '}
            <RichText>{t(UI.howToRead, locale)}</RichText>
          </p>
        </EditorialPanel>
      </div>
    </SectionFrame>
  )
}
