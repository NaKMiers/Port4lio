import { ArrowUpRight, Award, BookOpen, GraduationCap } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import CcafGate from '@/components/ccaf/CcafGate'
import {
  estimateScaledScore,
  MOCK_QUESTION_COUNT,
  overallProgress,
  PASS_SCALED_SCORE,
  readinessPercent,
  type CcafState,
} from '@/lib/ccaf/progress'
import { loadOwnerCcafState } from '@/lib/ccaf/progress-data'
import { sanitizeCertificates } from '@/lib/profile-copy'
import { loadPublicProfile } from '@/lib/profile-data'
import type { Certificate } from '@/types/profile'

export const metadata: Metadata = {
  title: 'Certificates',
  robots: { index: false, follow: false },
}

/**
 * `/admin/certificates` - every certificate, earned or in progress, on one page.
 *
 * ```
 *   /admin/certificates
 *     └── ccaf/            /admin/certificates/ccaf        the CCA-F roadmap
 *           └── vocab/     /admin/certificates/ccaf/vocab  its glossary
 * ```
 *
 * Two sources, deliberately not merged into one model:
 *
 * - **In progress** is one card per study tracker. Only CCA-F has one today; the next
 *   certificate that gets a tracker adds its folder next to `ccaf/` and a card here.
 * - **Earned** is `profile.certificates` - the same list the public About section renders,
 *   edited on `/admin/settings`. Reading it here rather than keeping a second list means a
 *   certificate added in the editor shows up on both without anyone remembering to.
 *
 * Gated the way `ccaf/page.tsx` is, and for the same reason: the tracker state is rendered
 * on the server, so it is withheld from a request without the owner cookie rather than
 * merely hidden by the client gate. The earned list is public data and needs no such care.
 */

function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return year && month && day ? `${day}/${month}/${year}` : iso
}

function hostOf(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

async function loadEarnedCertificates(): Promise<Certificate[] | null> {
  try {
    const profile = await loadPublicProfile()
    return sanitizeCertificates(profile.certificates ?? [])
  } catch {
    // The profile read already logs; this page just says it could not load the list.
    return null
  }
}

const eyebrowCls =
  'text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'

const pillCls =
  'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-pp-line bg-pp-panel-strong px-4 py-1.5 text-xs font-semibold text-pp-text no-underline shadow-[0_8px_18px_rgba(46,35,28,0.05)] transition hover:-translate-y-0.5'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted">
        {label}
      </dt>
      <dd className="mt-1 font-display text-lg font-semibold tabular-nums text-pp-text">
        {value}
      </dd>
    </div>
  )
}

function CcafCard({ state }: { state: CcafState }) {
  const progress = overallProgress(state.doneTaskIds)
  const readiness = readinessPercent(state.confidence)
  const bestMock = state.mocks.reduce<number | null>(
    (best, mock) =>
      best === null || mock.correct > best ? mock.correct : best,
    null
  )

  return (
    <article className="rounded-panel border border-pp-line bg-pp-panel p-6 shadow-panel backdrop-blur-md">
      <div className="flex flex-wrap items-start gap-4">
        <span
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-pp-pink/30 bg-pp-pink/10 text-pp-pink"
          aria-hidden
        >
          <GraduationCap size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={eyebrowCls}>Anthropic · CCA-F</p>
          <h3 className="mt-1 font-display text-xl font-semibold text-pp-text">
            Claude Certified Architect · Foundations
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/certificates/ccaf"
            className={pillCls}
          >
            Roadmap
            <ArrowUpRight
              aria-hidden
              size={13}
            />
          </Link>
          <Link
            href="/admin/certificates/ccaf/vocab"
            className={pillCls}
          >
            <BookOpen
              aria-hidden
              size={13}
            />
            Vocab
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-pp-text">
            Roadmap progress
          </span>
          <span className="font-mono text-xs tabular-nums text-pp-muted">
            {progress.done}/{progress.total} tasks · {progress.percent}%
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pp-line">
          <div
            className={`h-full rounded-full ${progress.percent === 100 ? 'bg-pp-green' : 'bg-pp-pink'}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-pp-line pt-4 sm:grid-cols-3">
        <Stat
          label="Exam date"
          value={formatIsoDate(state.examDate)}
        />
        <Stat
          label="Readiness"
          value={readiness === null ? '-' : `${readiness}%`}
        />
        <Stat
          label="Best mock"
          value={
            bestMock === null
              ? '-'
              : `${bestMock}/${MOCK_QUESTION_COUNT} · ≈${estimateScaledScore(bestMock)}`
          }
        />
      </dl>
      <p className="mt-3 text-xs text-pp-muted">
        Pass mark {PASS_SCALED_SCORE}. The mock score is a linear estimate, not
        Anthropic&apos;s scaling.
      </p>
    </article>
  )
}

function EarnedList({ certificates }: { certificates: Certificate[] | null }) {
  if (certificates === null)
    return (
      <p className="rounded-panel border border-pp-line bg-pp-panel p-6 text-sm text-pp-muted">
        Could not load the profile, so the earned list is unavailable right now.
      </p>
    )

  if (certificates.length === 0)
    return (
      <p className="rounded-panel border border-dashed border-pp-line bg-pp-panel p-6 text-sm text-pp-muted">
        None yet. Add them under{' '}
        <Link
          href="/admin/settings"
          className="text-pp-text"
        >
          Portfolio settings
        </Link>{' '}
        and they show up here and on the public About section.
      </p>
    )

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {certificates.map((cert, i) => {
        const host = cert.link ? hostOf(cert.link) : null
        const body = (
          <>
            <span
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-pp-green/30 bg-pp-green/10 text-pp-green"
              aria-hidden
            >
              <Award size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold leading-snug text-pp-text">
                {cert.name}
              </span>
              {host ? (
                <span className="mt-0.5 block truncate font-mono text-[11px] text-pp-muted">
                  {host}
                </span>
              ) : null}
            </span>
            {host ? (
              <ArrowUpRight
                className="mt-0.5 shrink-0 text-pp-muted transition-colors group-hover:text-pp-text"
                aria-hidden
                size={15}
              />
            ) : null}
          </>
        )
        const cls =
          'group flex h-full items-start gap-3 rounded-panel border border-pp-line bg-pp-panel p-4 no-underline shadow-panel backdrop-blur-md'

        return (
          <li key={`${cert.name}-${i}`}>
            {host ? (
              <a
                href={cert.link}
                target="_blank"
                rel="noopener noreferrer"
                className={`${cls} transition-transform motion-safe:hover:-translate-y-0.5`}
              >
                {body}
              </a>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default async function CertificatesPage() {
  const [ccafState, earned] = await Promise.all([
    loadOwnerCcafState(),
    loadEarnedCertificates(),
  ])

  return (
    <CcafGate>
      {ccafState ? (
        <main className="mx-auto w-full max-w-editorial px-gutter py-10">
          <header>
            <p className={eyebrowCls}>Owner</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl">
              Certificates
            </h1>
            <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-pp-muted">
              What is being studied for, and what is already done.
            </p>
          </header>

          <section
            aria-labelledby="certs-in-progress"
            className="mt-10"
          >
            <h2
              id="certs-in-progress"
              className={eyebrowCls}
            >
              In progress
            </h2>
            <div className="mt-3 space-y-5">
              <CcafCard state={ccafState} />
            </div>
          </section>

          <section
            aria-labelledby="certs-earned"
            className="mt-10"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2
                id="certs-earned"
                className={eyebrowCls}
              >
                Earned{earned?.length ? ` · ${earned.length}` : ''}
              </h2>
              <Link
                href="/admin/settings"
                className="text-xs font-semibold text-pp-muted hover:text-pp-text"
              >
                Edit in settings
              </Link>
            </div>
            <div className="mt-3">
              <EarnedList certificates={earned} />
            </div>
          </section>
        </main>
      ) : null}
    </CcafGate>
  )
}
