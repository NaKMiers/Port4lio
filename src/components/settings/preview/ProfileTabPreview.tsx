import React from 'react'

import {
  Chip,
  CutoffNote,
  EmptyHint,
  PreviewBlock,
  PreviewCard,
  limitNote,
  previewEyebrowCls,
} from '@/components/settings/preview/preview-primitives'
import type { PublicPortfolioViewModel } from '@/lib/profile-view-model'
import type { Profile } from '@/types/profile'

/** Same fallback the public hero uses when there is no avatar image. */
function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0]
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1]
  return (a ?? '?').toUpperCase() + (b ?? '').toUpperCase()
}

/** The hero tiles print three stats; the editor lets you add any number. */
const HERO_STAT_LIMIT = 3

/**
 * What the Profile tab publishes: the hero, the social strip, and the opening of the story.
 *
 * Every value comes off the view model rather than the raw profile, which is what makes the
 * fallback chains visible - `headline` is `profileHeading || fullName || 'Portfolio'`, and
 * seeing which rung is in play is usually the reason to look at a preview at all.
 */
export default function ProfileTabPreview({
  profile,
  viewModel,
}: {
  profile: Profile
  viewModel: PublicPortfolioViewModel
}) {
  const { hero, socialProof, about, founderProof } = viewModel
  const displayName = hero.fullName || hero.username || 'Your name'
  // The public hero joins with a middot; the old preview used a slash and disagreed.
  const titleLine = hero.jobTitles.join(' · ')
  const statNote = limitNote(hero.stats.length, HERO_STAT_LIMIT, 'the hero prints the first 3')
  const socialDropped = profile.socials.length - socialProof.profiles.length

  return (
    <div className='space-y-5'>
      <div className='overflow-hidden rounded-[1.3rem] border border-pp-line'>
        <div
          className='relative h-32'
          style={{
            backgroundImage: hero.backgroundImageUrl ? `url(${hero.backgroundImageUrl})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: hero.backgroundImageUrl ? undefined : '#f4ece2',
          }}
        >
          {/* The cover is a user-supplied photo, so it can be bright anywhere. The scrim
              carries most of the contrast and the text shadow covers the rest. */}
          <div
            className='absolute inset-0'
            style={{
              backgroundImage:
                'linear-gradient(180deg, rgba(26,23,21,0.18) 0%, rgba(26,23,21,0.06) 34%, rgba(26,23,21,0.62) 78%, rgba(26,23,21,0.88) 100%)',
            }}
          />
          <div className='absolute bottom-3 left-3 right-3 flex items-end gap-2.5'>
            {hero.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hero.avatarUrl}
                alt=''
                className='h-14 w-14 shrink-0 rounded-full border-2 border-white object-cover shadow-[0_10px_22px_rgba(17,17,17,0.4)]'
              />
            ) : (
              <div
                className='flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-white font-display text-base font-semibold text-white backdrop-blur-sm'
                style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}
              >
                {initials(displayName)}
              </div>
            )}
            <div className='min-w-0 pb-0.5'>
              {/* Colours set inline, not through Tailwind opacity utilities: an
                  ungenerated `text-white/NN` silently falls back to the inherited near-black
                  and disappears into the photo. */}
              <div
                className='truncate font-display text-base font-semibold tracking-tight'
                style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.55)' }}
              >
                {displayName}
              </div>
              <div
                className='truncate text-[11px] font-medium'
                style={{ color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
              >
                {titleLine || (hero.username ? `@${hero.username}` : 'No job titles yet')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <PreviewBlock title='Headline'>
        <div className='font-display text-lg font-semibold leading-snug tracking-tight text-pp-text'>
          {hero.headline}
        </div>
        {hero.subheadline ? (
          <p className='text-[13px] leading-relaxed text-pp-muted'>{hero.subheadline}</p>
        ) : null}
        {!profile.profileHeading ? (
          <CutoffNote>
            No profile heading set, so the hero falls back to{' '}
            {profile.fullName ? 'your full name' : '“Portfolio”'}.
          </CutoffNote>
        ) : null}
        {hero.description ? (
          <p className='text-[13px] leading-relaxed text-pp-muted'>{hero.description}</p>
        ) : null}
      </PreviewBlock>

      <PreviewBlock title='Stat tiles' count={hero.stats.length}>
        {hero.stats.length === 0 ? (
          <EmptyHint>No stats yet — the hero metric row and the “At a glance” band stay hidden.</EmptyHint>
        ) : (
          <>
            <div className='grid grid-cols-3 gap-2'>
              {hero.stats.slice(0, HERO_STAT_LIMIT).map(stat => (
                <div
                  key={stat.label}
                  className='rounded-[0.9rem] border border-pp-line bg-white/78 px-2 py-2'
                >
                  <div className='font-display text-lg font-semibold tabular-nums leading-none tracking-tight text-pp-text'>
                    {stat.value}
                  </div>
                  <div className='mt-1 text-[9px] font-semibold uppercase leading-tight tracking-[0.12em] text-pp-muted'>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
            {statNote ? <CutoffNote>{statNote}. All of them appear in the trust band.</CutoffNote> : null}
          </>
        )}
      </PreviewBlock>

      <PreviewBlock title='Social surfaces' count={socialProof.profiles.length}>
        {socialProof.profiles.length === 0 ? (
          <EmptyHint>No usable links — the social strip is not rendered at all.</EmptyHint>
        ) : (
          <>
            <p className='text-[11px] text-pp-muted'>
              Seen across {socialProof.profiles.length} live surface
              {socialProof.profiles.length > 1 ? 's' : ''}
            </p>
            <div className='flex flex-wrap gap-1.5'>
              {socialProof.profiles.map(link => (
                <Chip key={link.url}>{link.name}</Chip>
              ))}
            </div>
          </>
        )}
        {socialDropped > 0 ? (
          <CutoffNote>
            {socialDropped} link{socialDropped > 1 ? 's' : ''} hidden from the live site — each
            needs an http(s), mailto, tel or root-relative URL.
          </CutoffNote>
        ) : null}
      </PreviewBlock>

      <PreviewBlock title='Story' count={about.paragraphs.length}>
        {about.paragraphs.length === 0 ? (
          <EmptyHint>About Me is empty — the story panel and the pull quote stay hidden.</EmptyHint>
        ) : (
          <PreviewCard>
            <p className='text-[13px] leading-relaxed text-pp-text'>{about.paragraphs[0]}</p>
            {about.paragraphs.length > 1 ? (
              <p className='mt-2 text-[11px] text-pp-muted'>
                + {about.paragraphs.length - 1} more paragraph
                {about.paragraphs.length > 2 ? 's' : ''} below the lead
              </p>
            ) : null}
          </PreviewCard>
        )}
      </PreviewBlock>

      {founderProof.quote ? (
        <PreviewBlock title='Pull quote'>
          <PreviewCard className='border-l-2 border-l-pp-violet'>
            <p className='text-[13px] italic leading-relaxed text-pp-text'>
              “{founderProof.quote}”
            </p>
            <p className={`mt-2 ${previewEyebrowCls}`}>— {founderProof.attributionName}</p>
          </PreviewCard>
          <CutoffNote>
            Lifted automatically from the last paragraph of About Me — edit that paragraph to
            change it.
          </CutoffNote>
        </PreviewBlock>
      ) : null}
    </div>
  )
}
