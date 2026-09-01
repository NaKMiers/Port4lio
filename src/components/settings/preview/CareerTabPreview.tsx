import React from 'react'

import {
  Chip,
  CutoffNote,
  EmptyHint,
  PreviewBlock,
  PreviewCard,
  dropNote,
  previewEyebrowCls,
} from '@/components/settings/preview/preview-primitives'
import {
  formatPortfolioPeriod,
  sortEducationRecent,
  sortExperienceRecent,
} from '@/lib/profile-copy'
import type { PublicPortfolioViewModel } from '@/lib/profile-view-model'
import type { Profile } from '@/types/profile'

/** One row of the public career timeline, in the shape that component builds. */
type TimelineEntry = {
  key: string
  kicker: string
  title: string
  body: string
}

/**
 * What the Career tab publishes: the capability map and the career timeline.
 *
 * The public timeline inverts what the form implies, and reproducing that here is the whole
 * point of this panel: an experience row prints the **position** as its title with the
 * company underneath, and an education row prints the **major** as its title with the school
 * underneath. Ordering is most-recent-first, applied here because the view model hands these
 * arrays over in document order and the section sorts them at render time.
 */
export default function CareerTabPreview({
  profile,
  viewModel,
}: {
  profile: Profile
  viewModel: PublicPortfolioViewModel
}) {
  const { skills, experience, education, certificates } = viewModel.about

  const experienceEntries: TimelineEntry[] = sortExperienceRecent(experience).map((item, index) => ({
    key: `exp-${index}`,
    kicker: formatPortfolioPeriod(item.start, item.end),
    title: item.position || 'Role',
    body: item.companyName || 'Client or company',
  }))

  const educationEntries: TimelineEntry[] = sortEducationRecent(education).map((item, index) => ({
    key: `edu-${index}`,
    kicker: formatPortfolioPeriod(item.start, item.end),
    title: item.major || 'Program',
    body: item.schoolName || 'School',
  }))

  const certificateEntries: TimelineEntry[] = certificates.map((item, index) => ({
    key: `cert-${index}`,
    kicker: 'Verified learning',
    title: item.name || 'Certificate',
    body: item.link ? 'Open credential' : 'Credential recorded in portfolio',
  }))

  const skillItemCount = skills.reduce((total, group) => total + group.items.length, 0)
  const hasAnyTimeline =
    experienceEntries.length > 0 || educationEntries.length > 0 || certificateEntries.length > 0

  return (
    <div className='space-y-5'>
      <PreviewBlock title='Capability map' count={skills.length}>
        {skills.length === 0 ? (
          <EmptyHint>No skill groups — the capability column is not rendered.</EmptyHint>
        ) : (
          <div className='space-y-2'>
            {skills.map((group, index) => (
              <PreviewCard key={index}>
                <p className={previewEyebrowCls}>{group.groupName || 'Skills'}</p>
                {group.items.length === 0 ? (
                  <p className='mt-1.5 text-[11px] text-pp-muted'>No items in this group.</p>
                ) : (
                  <div className='mt-2 flex flex-wrap gap-1.5'>
                    {group.items.map((item, itemIndex) => (
                      <Chip key={itemIndex}>{item.name}</Chip>
                    ))}
                  </div>
                )}
              </PreviewCard>
            ))}
          </div>
        )}
        {dropNote(profile.skills.length, skills.length, 'a group name or at least one item') ? (
          <CutoffNote>
            {dropNote(profile.skills.length, skills.length, 'a group name or at least one item')}
          </CutoffNote>
        ) : null}
        {skillItemCount > 0 ? (
          <CutoffNote>
            Icons are not printed here — the public page renders skill items as text chips, so
            the icon you pick per item never reaches it.
          </CutoffNote>
        ) : null}
      </PreviewBlock>

      <PreviewBlock title='Career timeline'>
        {!hasAnyTimeline ? (
          <EmptyHint>
            No experience, education or certificates — the whole timeline block is hidden.
          </EmptyHint>
        ) : (
          <div className='space-y-3'>
            <TimelineGroup
              label='Experience'
              entries={experienceEntries}
              note={dropNote(
                profile.experience.length,
                experience.length,
                'a company or a position'
              )}
            />
            <TimelineGroup
              label='Education'
              entries={educationEntries}
              note={dropNote(profile.education.length, education.length, 'a school or a major')}
            />
            <TimelineGroup
              label='Certificates'
              entries={certificateEntries}
              note={dropNote(profile.certificates.length, certificates.length, 'a name')}
            />
          </div>
        )}
      </PreviewBlock>
    </div>
  )
}

/** One tab of the public timeline, flattened into a list - the rail has no room for tabs. */
function TimelineGroup({
  label,
  entries,
  note,
}: {
  label: string
  entries: TimelineEntry[]
  note: string | null
}) {
  if (entries.length === 0 && !note) return null

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-2'>
        <p className={previewEyebrowCls}>{label}</p>
        <span className='text-[10px] font-semibold tabular-nums text-pp-muted'>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {entries.map((entry, index) => (
        <PreviewCard key={entry.key}>
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0'>
              {entry.kicker ? <p className={previewEyebrowCls}>{entry.kicker}</p> : null}
              <p className='mt-0.5 text-[13px] font-semibold leading-snug text-pp-text'>
                {entry.title}
              </p>
              <p className='mt-0.5 text-[11px] leading-relaxed text-pp-muted'>{entry.body}</p>
            </div>
            <span className='shrink-0 rounded-full border border-pp-line bg-white/78 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-pp-muted'>
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>
        </PreviewCard>
      ))}
      {note ? <CutoffNote>{note}</CutoffNote> : null}
    </div>
  )
}
