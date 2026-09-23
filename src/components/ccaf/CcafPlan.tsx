import { CalendarDays, ChevronRight, ListChecks } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'

import RichText from '@/components/ccaf/RichText'
import {
  chipCls,
  cx,
  eyebrowCls,
  mutedMonoCls,
  secondaryBtnCls,
  tagAccentClass,
} from '@/components/ccaf/ccaf-ui'
import { useHasMounted } from '@/components/ccaf/use-mounted'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives'
import { t, UI, WEEKDAYS } from '@/lib/ccaf/copy'
import { weekProgress, type CcafState } from '@/lib/ccaf/progress'
import {
  TAG_LABEL,
  WEEKS,
  type RoadmapDay,
  type RoadmapTask,
} from '@/lib/ccaf/roadmap'
import type { Locale } from '@/lib/i18n'

/**
 * The plan itself: a week at a time, a day at a time.
 *
 * ## Why the details start collapsed
 *
 * Every task carries three to five steps and a completion criterion, which is what makes
 * the plan followable and also what makes 68 of them unreadable at once. Collapsed, a week
 * is a scannable list of seven days; expanded, one task is a complete instruction. The
 * per-week expand-all exists for the other mode - reading a whole week before starting it.
 *
 * Open state is deliberately not persisted. It describes what someone is reading right
 * now, not what they have done, and round-tripping it to Mongo would put a write on the
 * path of every disclosure click.
 */

function parseIsoDate(iso: string): Date | null {
  const parsed = new Date(`${iso}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDayMonth(iso: string): string {
  const [, month, day] = iso.split('-')
  return day && month ? `${day}/${month}` : iso
}

/**
 * Hours written the way the reader's language writes them: `8,5` in Vietnamese, `8.5` in
 * English.
 *
 * The task prose is authored with the local separator ("≈1,5 giờ"), so a bare JS number in
 * the chip beside it puts two conventions on the same row.
 */
const HOURS_LOCALE: Record<Locale, string> = { vi: 'vi-VN', en: 'en-US' }

function formatHours(hours: number, locale: Locale): string {
  return hours.toLocaleString(HOURS_LOCALE[locale])
}

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

type DayStatus = 'done' | 'today' | 'late' | 'ahead'

/**
 * Week tabs or one flat checklist, remembered per browser.
 *
 * `localStorage` rather than Mongo for the same reason open state is not persisted: it is a
 * reading preference, not progress. Read through `useSyncExternalStore` so the server and
 * the hydrating pass both render the week view, and the stored choice lands one commit
 * later without a `setState`-in-effect.
 */
type PlanView = 'week' | 'list'

const VIEW_STORAGE_KEY = 'ccaf-plan-view'
const viewListeners = new Set<() => void>()

function readView(): PlanView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list'
      ? 'list'
      : 'week'
  } catch {
    return 'week'
  }
}

// This visit's choice. Set before the storage write so it wins whether or not the write
// succeeds - private mode and blocked storage throw, and the toggle must still work.
let memoryView: PlanView | null = null

function writeView(view: PlanView) {
  memoryView = view
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // Storage unavailable; `memoryView` carries the choice for this visit.
  }
  viewListeners.forEach(listener => listener())
}

function subscribeView(listener: () => void) {
  viewListeners.add(listener)
  return () => {
    viewListeners.delete(listener)
  }
}

function usePlanView(): [PlanView, (view: PlanView) => void] {
  const view = useSyncExternalStore(
    subscribeView,
    () => memoryView ?? readView(),
    () => 'week' as const
  )
  return [view, writeView]
}

function ViewToggle({
  view,
  locale,
  onChange,
}: {
  view: PlanView
  locale: Locale
  onChange: (view: PlanView) => void
}) {
  const options = [
    { value: 'week', label: t(UI.viewByWeek, locale), Icon: CalendarDays },
    { value: 'list', label: t(UI.viewList, locale), Icon: ListChecks },
  ] as const

  return (
    <div
      role="group"
      aria-label={t(UI.viewGroup, locale)}
      className="inline-flex items-center gap-0.5 rounded-full border border-pp-line bg-pp-panel-strong p-0.5 shadow-[0_8px_18px_rgba(46,35,28,0.05)]"
    >
      {options.map(({ value, label, Icon }) => {
        const active = value === view
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={active}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue',
              active
                ? 'bg-pp-text text-[var(--pp-bg)] shadow-[0_6px_14px_rgba(31,28,26,0.18)]'
                : 'text-pp-muted hover:bg-pp-bg hover:text-pp-text'
            )}
          >
            <Icon
              className="h-3.5 w-3.5"
              aria-hidden="true"
            />
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Every task in the plan as one list of checkboxes - no tabs, no disclosures.
 *
 * For ticking things off quickly, or seeing what is left across the whole plan at once.
 * The steps stay in the week view; here the whole row is the checkbox's label.
 */
function ChecklistView({
  state,
  locale,
  doneIds,
  editable,
  onToggleTask,
}: {
  state: CcafState
  locale: Locale
  doneIds: Set<string>
  editable: boolean
  onToggleTask: (taskId: string) => void
}) {
  const [hideDone, setHideDone] = useState(false)

  // Day numbers run across the whole plan, as in the week view's day cards.
  const allRows = WEEKS.flatMap(week => week.days.map(day => ({ week, day })))
    .map(({ week, day }, i) => ({
      week,
      day,
      index: i + 1,
      date: day.floating ? state.examDate : (day.date ?? ''),
    }))
    .flatMap(({ week, day, index, date }) =>
      day.tasks.map(task => ({ week, task, day, index, date }))
    )
  const total = allRows.length
  const done = allRows.filter(row => doneIds.has(row.task.id)).length
  const percent = total ? Math.round((done / total) * 100) : 0

  const visible = hideDone
    ? allRows.filter(row => !doneIds.has(row.task.id))
    : allRows
  const weeks = WEEKS.map(week => ({
    week,
    rows: visible.filter(row => row.week.id === week.id),
  })).filter(group => group.rows.length > 0)

  return (
    <EditorialPanel
      variant="strong"
      className="p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-pp-line pb-3">
        <span className="font-display text-2xl font-semibold tabular-nums text-pp-text">
          {percent}%
        </span>
        <span className={cx(mutedMonoCls, 'tabular-nums')}>
          {done}/{total} {t(UI.tasksSuffix, locale)}
        </span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-pp-muted">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={() => setHideDone(value => !value)}
            className="h-4 w-4 accent-pp-blue"
          />
          {t(UI.hideDone, locale)}
        </label>
      </div>

      {weeks.length === 0 ? (
        <p className="py-6 text-center text-sm text-pp-muted">
          {t(UI.listAllDone, locale)}
        </p>
      ) : (
        <div className="space-y-4">
          {weeks.map(({ week, rows }) => (
            <section key={week.id}>
              <h3 className={cx(eyebrowCls, 'mb-1 px-2')}>
                {t(week.label, locale)} · {t(week.phase, locale)}
              </h3>
              <ul className="space-y-0.5">
                {rows.map(({ task, day, index, date }) => {
                  const checked = doneIds.has(task.id)
                  const parsed = parseIsoDate(date)
                  return (
                    <li key={task.id}>
                      <label
                        className={cx(
                          'grid grid-cols-[1.125rem_minmax(0,1fr)_auto] items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-pp-bg/50',
                          editable ? 'cursor-pointer' : 'cursor-not-allowed'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!editable}
                          onChange={() => onToggleTask(task.id)}
                          // Titles can hold links, whose text would otherwise leak into
                          // the checkbox's accessible name via the wrapping label.
                          aria-label={`${t(UI.markComplete, locale)}: ${t(task.title, locale).replace(/<[^>]+>/g, '')}`}
                          className="mt-1 h-[18px] w-[18px] shrink-0 accent-pp-blue disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <span
                          className={cx(
                            'min-w-0 text-sm leading-relaxed',
                            checked
                              ? 'text-pp-muted line-through decoration-pp-line'
                              : 'text-pp-text'
                          )}
                        >
                          <RichText>{t(task.title, locale)}</RichText>
                        </span>
                        <span
                          className={cx(
                            mutedMonoCls,
                            'mt-0.5 whitespace-nowrap tabular-nums'
                          )}
                        >
                          {day.floating
                            ? `${t(UI.examDayLabel, locale)} ★`
                            : `${t(UI.dayLabel, locale)} ${String(index).padStart(2, '0')}`}
                          {parsed ? ` · ${formatDayMonth(date)}` : ''}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </EditorialPanel>
  )
}

function TaskRow({
  task,
  locale,
  checked,
  editable,
  open,
  onToggleOpen,
  onToggleDone,
}: {
  task: RoadmapTask
  locale: Locale
  checked: boolean
  editable: boolean
  open: boolean
  onToggleOpen: () => void
  onToggleDone: () => void
}) {
  const detailsId = `ccaf-detail-${task.id}`
  const plainTitle = t(task.title, locale).replace(/<[^>]+>/g, '')

  return (
    <li className="min-w-0">
      <div className="grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-pp-bg/50">
        <input
          type="checkbox"
          id={`ccaf-task-${task.id}`}
          checked={checked}
          disabled={!editable}
          onChange={onToggleDone}
          className="mt-1 h-[18px] w-[18px] shrink-0 accent-pp-blue disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`${t(UI.markComplete, locale)}: ${plainTitle}`}
        />
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          aria-controls={detailsId}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_1rem] items-start gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue"
        >
          <span className="min-w-0">
            <span
              className={cx(
                'text-sm leading-relaxed',
                checked
                  ? 'text-pp-muted line-through decoration-pp-line'
                  : 'text-pp-text'
              )}
            >
              <RichText>{t(task.title, locale)}</RichText>
            </span>
            <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
              {task.tags.map(tag => (
                <span
                  key={tag}
                  className={cx(chipCls, 'px-2 py-0.5 text-[10px]')}
                >
                  <span
                    className={cx(
                      'h-1.5 w-1.5 rounded-full',
                      tagAccentClass(tag)
                    )}
                    aria-hidden="true"
                  />
                  {t(TAG_LABEL[tag], locale)}
                </span>
              ))}
            </span>
          </span>
          <ChevronRight
            className={cx(
              'mt-1 h-4 w-4 shrink-0 text-pp-muted transition-transform duration-200',
              open && 'rotate-90 text-pp-blue'
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      <div
        id={detailsId}
        hidden={!open}
        className="ml-[1.9rem] mt-1 rounded-xl border border-l-2 border-pp-line border-l-pp-blue bg-pp-bg/60 px-4 py-3.5"
      >
        <ol className="ml-4 list-decimal space-y-1.5 text-sm leading-relaxed text-pp-muted marker:font-semibold marker:text-pp-blue">
          {task.steps.map((step, i) => (
            <li key={i}>
              <RichText>{t(step, locale)}</RichText>
            </li>
          ))}
        </ol>
        {task.code ? (
          <pre className="mt-3 overflow-x-auto rounded-lg border border-pp-line bg-pp-panel-strong px-3 py-2.5 font-mono text-xs leading-relaxed text-pp-text">
            {task.code}
          </pre>
        ) : null}
        <p className="mt-3 border-t border-dashed border-pp-line pt-2.5 text-[13px] leading-relaxed text-pp-muted">
          <strong className="font-semibold text-pp-green">
            {t(UI.doneWhenLabel, locale)}
          </strong>{' '}
          <RichText>{t(task.doneWhen, locale)}</RichText>
        </p>
      </div>
    </li>
  )
}

function DayCard({
  day,
  locale,
  index,
  date,
  status,
  doneIds,
  editable,
  openIds,
  onToggleOpen,
  onToggleTask,
}: {
  day: RoadmapDay
  locale: Locale
  index: number
  date: string
  status: DayStatus
  doneIds: Set<string>
  editable: boolean
  openIds: Set<string>
  onToggleOpen: (taskId: string) => void
  onToggleTask: (taskId: string) => void
}) {
  const done = day.tasks.filter(task => doneIds.has(task.id)).length
  const percent = day.tasks.length
    ? Math.round((done / day.tasks.length) * 100)
    : 0
  const parsed = parseIsoDate(date)

  return (
    <EditorialPanel
      variant={status === 'today' ? 'strong' : 'default'}
      className={cx(
        'overflow-hidden',
        status === 'today' && 'ring-1 ring-pp-blue/35',
        status === 'done' && 'opacity-90'
      )}
    >
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] sm:grid-cols-[4.75rem_minmax(0,1fr)]">
        <div
          className={cx(
            'flex flex-col items-center justify-start gap-0.5 border-r border-pp-line px-2 py-4 text-center',
            status === 'today' ? 'bg-pp-blue/10' : 'bg-pp-bg/40'
          )}
        >
          <span className={cx(mutedMonoCls, 'uppercase tracking-[0.12em]')}>
            {day.floating ? t(UI.examDayLabel, locale) : t(UI.dayLabel, locale)}
          </span>
          <span className="font-display text-2xl font-semibold leading-none tracking-tight text-pp-text">
            {day.floating ? '★' : String(index).padStart(2, '0')}
          </span>
          <span className="text-[11px] leading-tight text-pp-muted">
            {parsed ? WEEKDAYS[locale][parsed.getDay()] : ''}
            <br />
            {formatDayMonth(date)}
          </span>
        </div>

        <div className="min-w-0 px-3 py-3.5 sm:px-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h4 className="mr-auto font-display text-base font-semibold leading-snug text-pp-text">
              {t(day.title, locale)}
            </h4>
            <span className={cx(chipCls, 'px-2 py-0.5 text-[10px]')}>
              ≈{formatHours(day.hours, locale)} {t(UI.hoursSuffix, locale)}
            </span>
            {status === 'today' ? (
              <span
                className={cx(
                  chipCls,
                  'border-pp-blue/40 bg-pp-blue/10 px-2 py-0.5 text-[10px] text-pp-blue'
                )}
              >
                {t(UI.today, locale)}
              </span>
            ) : null}
            {status === 'done' ? (
              <span
                className={cx(
                  chipCls,
                  'border-pp-green/40 bg-pp-green/10 px-2 py-0.5 text-[10px] text-pp-green'
                )}
              >
                {t(UI.statusDone, locale)}
              </span>
            ) : null}
            {status === 'late' ? (
              <span
                className={cx(
                  chipCls,
                  'border-pp-orange/40 bg-pp-orange/10 px-2 py-0.5 text-[10px] text-pp-orange'
                )}
              >
                {t(UI.statusBehind, locale)}
              </span>
            ) : null}
            <span className={cx(mutedMonoCls, 'tabular-nums')}>
              {done}/{day.tasks.length}
            </span>
            <span className="h-1 w-14 overflow-hidden rounded-full bg-pp-line">
              <span
                className={cx(
                  'block h-full rounded-full transition-[width] duration-300',
                  percent === 100 ? 'bg-pp-green' : 'bg-pp-text'
                )}
                style={{ width: `${percent}%` }}
              />
            </span>
          </div>

          <ul className="space-y-0.5">
            {day.tasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                locale={locale}
                checked={doneIds.has(task.id)}
                editable={editable}
                open={openIds.has(task.id)}
                onToggleOpen={() => onToggleOpen(task.id)}
                onToggleDone={() => onToggleTask(task.id)}
              />
            ))}
          </ul>
        </div>
      </div>
    </EditorialPanel>
  )
}

export default function CcafPlan({
  state,
  locale,
  editable,
  onToggleTask,
  rail,
}: {
  state: CcafState
  locale: Locale
  editable: boolean
  onToggleTask: (taskId: string) => void
  rail: ReactNode
}) {
  // Same string on every render once mounted, so it is a stable `useMemo` dependency.
  const today = useHasMounted() ? toIsoDate(new Date()) : null

  const doneIds = useMemo(() => new Set(state.doneTaskIds), [state.doneTaskIds])
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [view, setView] = usePlanView()

  /**
   * Which week opens first: the one containing today, else the first unfinished one, else
   * the last. Landing on "week 1, 100%" three weeks in would make the page feel like an
   * archive rather than something being used.
   */
  const defaultWeekId = useMemo(() => {
    if (today) {
      const current = WEEKS.find(week =>
        week.days.some(
          day => (day.floating ? state.examDate : day.date) === today
        )
      )
      if (current) return current.id
      const upcoming = WEEKS.find(week =>
        week.days.some(day => {
          const date = day.floating ? state.examDate : day.date
          return date !== null && date >= today
        })
      )
      if (upcoming) return upcoming.id
    }
    const unfinished = WEEKS.find(
      week => weekProgress(week.id, state.doneTaskIds).percent < 100
    )
    return (unfinished ?? WEEKS[WEEKS.length - 1])?.id ?? WEEKS[0]?.id ?? ''
  }, [today, state.examDate, state.doneTaskIds])

  const [activeWeekId, setActiveWeekId] = useState<string | null>(null)
  const weekId = activeWeekId ?? defaultWeekId
  const week = WEEKS.find(candidate => candidate.id === weekId) ?? WEEKS[0]

  if (!week) return null

  const weekStats = weekProgress(week.id, state.doneTaskIds)
  const weekHours = week.days.reduce((sum, day) => sum + day.hours, 0)
  const weekTaskIds = week.days.flatMap(day => day.tasks.map(task => task.id))
  const allOpen = weekTaskIds.every(id => openIds.has(id))

  const dayStatus = (date: string, tasks: RoadmapTask[]): DayStatus => {
    if (tasks.every(task => doneIds.has(task.id))) return 'done'
    if (!today) return 'ahead'
    if (date === today) return 'today'
    return date < today ? 'late' : 'ahead'
  }

  // Day numbers run across the whole plan, not per week - "day 15" is how the plan refers
  // to itself, and restarting at 1 each tab would break that.
  const dayOffset = WEEKS.slice(
    0,
    WEEKS.findIndex(candidate => candidate.id === week.id)
  ).reduce((sum, candidate) => sum + candidate.days.length, 0)

  return (
    <SectionFrame
      id="ccaf-plan"
      aria-labelledby="ccaf-plan-heading"
      className="scroll-mt-24 border-b border-pp-line pt-8 md:scroll-mt-28 md:pt-12"
    >
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <p className={eyebrowCls}>{t(UI.planEyebrow, locale)}</p>
            <h2
              id="ccaf-plan-heading"
              className="text-pretty font-display text-[clamp(1.65rem,3.6vw,2.35rem)] font-semibold leading-tight tracking-tight text-pp-text"
            >
              {t(UI.planHeading, locale)}
            </h2>
          </div>
          {/* `ml-auto` keeps it on the right even when it wraps below the heading. */}
          <div className="ml-auto">
            <ViewToggle
              view={view}
              locale={locale}
              onChange={setView}
            />
          </div>
        </header>

        {view === 'list' ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
            <div className="min-w-0">
              <ChecklistView
                state={state}
                locale={locale}
                doneIds={doneIds}
                editable={editable}
                onToggleTask={onToggleTask}
              />
            </div>
            <div className="space-y-4 lg:sticky lg:top-6">{rail}</div>
          </div>
        ) : (
          <>
            <nav
              aria-label={t(UI.weeksNavLabel, locale)}
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            >
              {WEEKS.map(candidate => {
                const stats = weekProgress(candidate.id, state.doneTaskIds)
                const active = candidate.id === week.id
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setActiveWeekId(candidate.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cx(
                      'rounded-panel border px-4 py-3 text-left motion-safe:transition-[transform,border-color,background-color,box-shadow] motion-safe:duration-200',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue',
                      active
                        ? 'border-pp-blue bg-pp-panel-strong shadow-[0_14px_32px_rgba(51,152,255,0.2)] ring-1 ring-pp-blue/35 motion-safe:-translate-y-0.5'
                        : 'border-pp-line bg-pp-panel hover:border-pp-muted/40'
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cx(
                          'font-display text-sm font-semibold',
                          active ? 'text-pp-blue' : 'text-pp-text'
                        )}
                      >
                        {t(candidate.label, locale)}
                      </span>
                      <span className={mutedMonoCls}>{candidate.range}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-pp-muted">
                      {t(candidate.phase, locale)} · {stats.done}/{stats.total}
                    </span>
                    <span className="mt-2 block h-1 overflow-hidden rounded-full bg-pp-line">
                      <span
                        className={cx(
                          'block h-full rounded-full transition-[width] duration-300',
                          stats.percent === 100
                            ? 'bg-pp-green'
                            : active
                              ? 'bg-pp-blue'
                              : 'bg-pp-text'
                        )}
                        style={{ width: `${stats.percent}%` }}
                      />
                    </span>
                  </button>
                )
              })}
            </nav>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
              <div className="min-w-0 space-y-4">
                <EditorialPanel
                  variant="strong"
                  className="border-l-4 border-l-pp-blue p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <h3 className="font-display text-xl font-semibold tracking-tight text-pp-text">
                        {t(week.label, locale)} · {t(week.phase, locale)}
                      </h3>
                      <p className="text-sm leading-relaxed text-pp-muted">
                        {t(week.desc, locale)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 sm:w-[11.5rem] sm:flex-col sm:items-end">
                      <span className="font-display text-2xl font-semibold tabular-nums text-pp-text">
                        {weekStats.percent}%
                      </span>
                      <span className={cx(mutedMonoCls, 'whitespace-nowrap')}>
                        {weekStats.done}/{weekStats.total}{' '}
                        {t(UI.tasksSuffix, locale)} · ≈
                        {formatHours(weekHours, locale)}{' '}
                        {t(UI.hoursSuffix, locale)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenIds(current => {
                            const next = new Set(current)
                            if (allOpen)
                              weekTaskIds.forEach(id => next.delete(id))
                            else weekTaskIds.forEach(id => next.add(id))
                            return next
                          })
                        }
                        className={cx(
                          secondaryBtnCls,
                          'min-h-[34px] px-3 py-1 text-xs'
                        )}
                      >
                        {allOpen
                          ? t(UI.collapseAll, locale)
                          : t(UI.expandAll, locale)}
                      </button>
                    </div>
                  </div>
                </EditorialPanel>

                {week.days.map((day, i) => {
                  const date = day.floating ? state.examDate : (day.date ?? '')
                  return (
                    <DayCard
                      key={day.id}
                      day={day}
                      locale={locale}
                      index={dayOffset + i + 1}
                      date={date}
                      status={dayStatus(date, day.tasks)}
                      doneIds={doneIds}
                      editable={editable}
                      openIds={openIds}
                      onToggleOpen={taskId =>
                        setOpenIds(current => {
                          const next = new Set(current)
                          if (next.has(taskId)) next.delete(taskId)
                          else next.add(taskId)
                          return next
                        })
                      }
                      onToggleTask={onToggleTask}
                    />
                  )
                })}
              </div>

              <div className="space-y-4 lg:sticky lg:top-6">{rail}</div>
            </div>
          </>
        )}
      </div>
    </SectionFrame>
  )
}
