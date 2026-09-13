import { ArrowUpRight } from 'lucide-react'

import RichText from '@/components/ccaf/RichText'
import {
  chipCls,
  cx,
  eyebrowCls,
  mutedMonoCls,
} from '@/components/ccaf/ccaf-ui'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives'
import { t, UI } from '@/lib/ccaf/copy'
import {
  ANSWER_TRAPS,
  EXAM_DAY_CHECKS,
  FACT_GROUPS,
  JUDGMENT_RULES,
  OUT_OF_SCOPE,
  RESOURCES,
} from '@/lib/ccaf/reference'
import type { Locale } from '@/lib/i18n'

/**
 * The cram sheet, and the one interactive thing in it - the exam-day checklist.
 *
 * The checklist lives here rather than up in the rail because it is read in a different
 * situation from everything else on the page: not while studying, but in the ten minutes
 * before sitting down. Its state still belongs to the same document, which is why the
 * toggle is a prop from the tracker above rather than local state.
 */

function CardHeading({
  kicker,
  title,
  note,
}: {
  kicker: string
  title: string
  note?: string
}) {
  return (
    <div className='mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1'>
      <span className={cx(eyebrowCls, 'text-pp-blue')}>{kicker}</span>
      <h3 className='mr-auto font-display text-base font-semibold tracking-tight text-pp-text'>
        {title}
      </h3>
      {note ? <span className={mutedMonoCls}>{note}</span> : null}
    </div>
  )
}

export default function CcafReference({
  locale,
  doneCheckIds,
  editable,
  onToggleCheck,
}: {
  locale: Locale
  doneCheckIds: string[]
  editable: boolean
  onToggleCheck: (checkId: string) => void
}) {
  const done = new Set(doneCheckIds)

  return (
    <SectionFrame
      id='ccaf-reference'
      aria-labelledby='ccaf-reference-heading'
      className='scroll-mt-24 md:scroll-mt-28'
    >
      <div className='space-y-6'>
        <header className='max-w-3xl space-y-3'>
          <p className={eyebrowCls}>{t(UI.referenceEyebrow, locale)}</p>
          <h2
            id='ccaf-reference-heading'
            className='text-pretty font-display text-[clamp(1.65rem,3.6vw,2.35rem)] font-semibold leading-tight tracking-tight text-pp-text'
          >
            {t(UI.referenceHeading, locale)}
          </h2>
        </header>

        <EditorialPanel
          variant='strong'
          className='p-5 sm:p-6'
        >
          <CardHeading
            kicker={t(UI.factsKicker, locale)}
            title={t(UI.factsTitle, locale)}
            note={t(UI.factsNote, locale)}
          />
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
            {FACT_GROUPS.map((group, groupIndex) => (
              <div
                key={groupIndex}
                className='rounded-xl border border-pp-line bg-pp-bg/50 px-4 py-3.5'
              >
                <h4 className='font-display text-sm font-semibold leading-snug text-pp-text'>
                  {t(group.title, locale)}
                </h4>
                <ul className='mt-2 ml-4 list-disc space-y-1.5 text-[13px] leading-relaxed text-pp-muted marker:text-pp-blue'>
                  {group.items.map((item, i) => (
                    <li key={i}>
                      <RichText>{t(item, locale)}</RichText>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </EditorialPanel>

        <div className='grid gap-6 lg:grid-cols-2'>
          <EditorialPanel
            variant='default'
            className='p-5 sm:p-6'
          >
            <CardHeading
              kicker={t(UI.rulesKicker, locale)}
              title={t(UI.rulesTitle, locale)}
              note={t(UI.rulesNote, locale)}
            />
            <ol className='space-y-2.5'>
              {JUDGMENT_RULES.map((rule, i) => (
                <li
                  key={i}
                  className='grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 border-b border-pp-line pb-2.5 text-[13px] leading-relaxed text-pp-muted last:border-b-0 last:pb-0'
                >
                  <span className='pt-0.5 font-mono text-[11px] font-semibold text-pp-blue'>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <RichText>{t(rule, locale)}</RichText>
                  </span>
                </li>
              ))}
            </ol>
          </EditorialPanel>

          <div className='space-y-6'>
            <EditorialPanel
              variant='default'
              className='p-5 sm:p-6'
            >
              <CardHeading
                kicker={t(UI.trapsKicker, locale)}
                title={t(UI.trapsTitle, locale)}
                note={t(UI.trapsNote, locale)}
              />
              <p className='mb-3 text-[13px] leading-relaxed text-pp-muted'>
                {t(UI.trapsIntroBefore, locale)}
                <strong className='font-semibold text-pp-text'>
                  {t(UI.trapsIntroStrong, locale)}
                </strong>
                .
              </p>
              <dl className='space-y-2'>
                {ANSWER_TRAPS.map((trap, i) => (
                  <div
                    key={i}
                    className='grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2'
                  >
                    <dt>
                      <code className='rounded border border-pp-pink/40 bg-pp-pink/10 px-1.5 py-px font-mono text-[11px] text-pp-text'>
                        {t(trap.token, locale)}
                      </code>
                    </dt>
                    <dd className='text-[13px] leading-relaxed text-pp-muted'>
                      <RichText>{t(trap.why, locale)}</RichText>
                    </dd>
                  </div>
                ))}
              </dl>
            </EditorialPanel>

            <EditorialPanel
              variant='default'
              className='p-5 sm:p-6'
            >
              <CardHeading
                kicker={t(UI.scopeKicker, locale)}
                title={t(UI.scopeTitle, locale)}
              />
              <ul className='ml-4 list-disc space-y-1.5 text-[13px] leading-relaxed text-pp-muted marker:text-pp-muted/60'>
                {OUT_OF_SCOPE.map((item, i) => (
                  <li key={i}>{t(item, locale)}</li>
                ))}
              </ul>
            </EditorialPanel>
          </div>
        </div>

        <div className='grid gap-6 lg:grid-cols-2'>
          <EditorialPanel
            variant='strong'
            className='p-5 sm:p-6'
          >
            <CardHeading
              kicker={t(UI.examDayKicker, locale)}
              title={t(UI.examDayTitle, locale)}
              note={`${done.size}/${EXAM_DAY_CHECKS.length}`}
            />
            <ul className='space-y-0.5'>
              {EXAM_DAY_CHECKS.map(check => (
                <li key={check.id}>
                  <label className='grid cursor-pointer grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-pp-bg/60'>
                    <input
                      type='checkbox'
                      checked={done.has(check.id)}
                      disabled={!editable}
                      onChange={() => onToggleCheck(check.id)}
                      className='mt-0.5 h-[18px] w-[18px] shrink-0 accent-pp-blue disabled:cursor-not-allowed disabled:opacity-50'
                    />
                    <span
                      className={cx(
                        'text-[13px] leading-relaxed text-pp-muted',
                        done.has(check.id) && 'line-through decoration-pp-line'
                      )}
                    >
                      <RichText>{t(check.text, locale)}</RichText>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </EditorialPanel>

          <EditorialPanel
            variant='default'
            className='p-5 sm:p-6'
          >
            <CardHeading
              kicker={t(UI.resourcesKicker, locale)}
              title={t(UI.resourcesTitle, locale)}
            />
            <ul className='space-y-1.5'>
              {RESOURCES.map(resource => (
                <li key={resource.href}>
                  <a
                    href={resource.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-pp-line px-3 py-2.5 no-underline transition-colors hover:border-pp-blue/40 hover:bg-pp-bg/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
                  >
                    <span className='min-w-0 text-[13px] font-medium text-pp-text'>
                      {t(resource.label, locale)}
                      <span className='sr-only'> ({t(UI.newTab, locale)})</span>
                    </span>
                    <span className='flex shrink-0 items-center gap-1.5'>
                      <span className={cx(chipCls, 'px-2 py-0.5 text-[10px]')}>
                        {t(resource.note, locale)}
                      </span>
                      <ArrowUpRight
                        className='h-3.5 w-3.5 text-pp-muted transition-colors group-hover:text-pp-blue'
                        aria-hidden='true'
                      />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </EditorialPanel>
        </div>
      </div>
    </SectionFrame>
  )
}
