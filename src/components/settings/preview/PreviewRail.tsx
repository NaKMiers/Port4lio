'use client'

import React, { useMemo, useState } from 'react'

import CareerTabPreview from '@/components/settings/preview/CareerTabPreview'
import CvTabPreview, {
  useCvPrint,
} from '@/components/settings/preview/CvTabPreview'
import OfferingTabPreview from '@/components/settings/preview/OfferingTabPreview'
import ProfileTabPreview from '@/components/settings/preview/ProfileTabPreview'
import { MAX_UPLOAD_MB_LABEL } from '@/components/settings/settings-utils'
import type { SettingTabId } from '@/components/settings/types'
import { toPublicProfile } from '@/lib/profile-public'
import { derivePublicPortfolioViewModel } from '@/lib/profile-view-model'
import type { Profile } from '@/types/profile'

/**
 * The editor's live preview column, one panel per tab.
 *
 * Two things make it trustworthy. First, it renders from
 * {@link derivePublicPortfolioViewModel} - the same transform `/` runs - so the sanitizers,
 * fallbacks, sort orders and caps that shape the live site shape the preview too. The panel
 * this replaces read raw `Profile` fields and quietly disagreed with the site: `' / '`
 * between job titles where the hero prints `' · '`, four stat tiles where the hero prints
 * three, `aboutMe` cut at a hardcoded 240 characters.
 *
 * Second, it is derived state, not fetched state, so it is live by construction - the
 * editor already replaces `profile` on every keystroke.
 *
 * The CV tab is the exception: the printed CV has fixed A4 geometry that no summary can
 * stand in for, so it renders the real sheets. See `CvTabPreview`.
 */

const TAB_LABEL: Record<SettingTabId, string> = {
  profile: 'Hero & story',
  career: 'Background',
  offering: 'Services & work',
  cv: 'Printed CV',
}

/** Tabs whose fields accept a file. The upload tip is noise on the others. */
const TABS_WITH_UPLOADS: ReadonlySet<SettingTabId> = new Set<SettingTabId>([
  'profile',
  'offering',
  'cv',
])

const headerActionBtnCls =
  'rounded-full border border-pp-line bg-white/86 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-pp-text shadow-[0_8px_16px_rgba(46,35,28,0.06)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60'

export default function PreviewRail({
  tab,
  profile,
}: {
  tab: SettingTabId
  profile: Profile
}) {
  // `toPublicProfile` is the allowlist gate, so the preview can only ever show what is
  // publishable - a private field added to `Profile` later cannot leak in here by accident.
  const viewModel = useMemo(
    () => derivePublicPortfolioViewModel(toPublicProfile(profile)),
    [profile]
  )

  // Lifted out of `CvTabPreview` so the download/expand actions can sit in this header,
  // in line with "Live preview", instead of stacked as full-width buttons below the sheets.
  const { printing, startPrint } = useCvPrint()
  const [cvExpanded, setCvExpanded] = useState(false)

  return (
    // One sticky box the height of the viewport, with the preview scrolling inside it.
    // Capping the whole column - rather than just the panel - is what makes every tab stick
    // the same way: the footer notes below vary per tab, and letting them extend the sticky
    // element past the viewport is what stops a `position: sticky` box from holding still.
    <div className="flex flex-col gap-4 xl:sticky xl:top-10 xl:max-h-[calc(100vh-5rem)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-[1.9rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(255,250,246,0.74))] shadow-panel backdrop-blur-md">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-pp-line px-4 py-3">
          <span className="bg-white/86 rounded-full border border-pp-line px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-pp-text">
            Live preview
          </span>
          {tab === 'cv' ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className={headerActionBtnCls}
                disabled={printing}
                onClick={startPrint}
              >
                {printing ? 'Preparing...' : 'Download PDF'}
              </button>
              <button
                type="button"
                className={headerActionBtnCls}
                onClick={() => setCvExpanded(true)}
              >
                Expand
              </button>
            </div>
          ) : (
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
              {TAB_LABEL[tab]}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {tab === 'profile' ? (
            <ProfileTabPreview
              profile={profile}
              viewModel={viewModel}
            />
          ) : null}
          {tab === 'career' ? (
            <CareerTabPreview
              profile={profile}
              viewModel={viewModel}
            />
          ) : null}
          {tab === 'offering' ? (
            <OfferingTabPreview
              profile={profile}
              viewModel={viewModel}
            />
          ) : null}
          {tab === 'cv' ? (
            <CvTabPreview
              profile={profile}
              printing={printing}
              startPrint={startPrint}
              expanded={cvExpanded}
              onCloseExpand={() => setCvExpanded(false)}
            />
          ) : null}
        </div>
      </div>

      {TABS_WITH_UPLOADS.has(tab) ? (
        <div className="bg-white/62 shrink-0 rounded-[1.3rem] border border-pp-line px-4 py-3 text-xs leading-relaxed text-pp-muted shadow-[0_12px_24px_rgba(46,35,28,0.05)] backdrop-blur-sm">
          {tab === 'cv' ? (
            <>
              The CV is length-capped by the sheet, not reflowed: anything past
              297mm is cut off rather than pushed to a third page. Reordering
              re-measures the sheets on its own; after an edit that made the
              copy longer, use{' '}
              <span className="font-semibold text-pp-text">Fit to sheet 1</span>{' '}
              in <span className="font-semibold text-pp-text">CV Projects</span>{' '}
              to rebalance.
            </>
          ) : (
            <>
              Tip: files upload to Cloudinary as you pick them (max{' '}
              {MAX_UPLOAD_MB_LABEL} MB each).{' '}
              <span className="mr-1 font-semibold text-pp-text">
                Save profile
              </span>{' '}
              still sends JSON only, which keeps the payload well under
              Vercel&apos;s request size limit.
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
