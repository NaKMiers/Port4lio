'use client'

import Link from 'next/link'

import BlogLocaleSwitcher from '@/components/blog/BlogLocaleSwitcher'
import { useBlogLocale } from '@/components/blog/BlogLocaleProvider'

/**
 * The `/blog` masthead: who writes this, what it is about, how big it is, and where else to go.
 *
 * ## Why a stranger is the reader it is written for
 *
 * The previous copy opened "Things I measured while shipping" over "Every post here has a
 * number in it or a failure with a name" - true, good writing, and opaque unless you already
 * knew whose site this was. It named no author, no subject and no scale, which are the three
 * questions somebody arriving from a search result asks before deciding to read anything.
 *
 * The rewrite keeps the specificity and drops the idiom. A large share of the audience for
 * posts about Next.js reads English as a second language, and "a failure with a name" is the
 * kind of phrase that survives translation badly.
 *
 * ## Why this is a client component
 *
 * Only so the VI/EN toggle can reach it. The strings come from `useBlogLocale`, which is a
 * context read - there is no fetch here and no loading state. It still renders on the server
 * for the initial HTML, in English, which is what `<html lang='en'>` says and what a crawler
 * should see.
 */
export default function BlogIndexHeader({
  postCount,
  topics,
}: {
  postCount: number
  /** The three most common tags, derived by the page so this does not query for them. */
  topics: string[]
}) {
  const { copy } = useBlogLocale()

  return (
    <header>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>
          {copy.eyebrow}
        </p>
        <BlogLocaleSwitcher />
      </div>

      <h1 className='mt-2 font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl'>
        {copy.title}
      </h1>

      <p className='mt-3 text-sm text-pp-muted'>
        {copy.writtenBy}{' '}
        <Link href='/' className='font-semibold text-pp-text no-underline hover:text-pp-blue'>
          Anh Khoa Nguyen
        </Link>{' '}
        &middot; {copy.role}
      </p>

      <p className='mt-5 max-w-[62ch] text-lg leading-relaxed text-pp-muted'>{copy.intro}</p>

      {/*
        The count is rendered rather than hidden, which is the opposite bet from the old
        card-level decision to omit dates for fear of looking new. A reader can see how long
        the list is anyway; stating it reads as confidence, and hiding it reads as nothing.
      */}
      <p className='mt-4 text-sm text-pp-muted'>
        {postCount === 1 ? copy.postsCountOne : copy.postsCountMany(postCount)}
        {topics.length > 0 ? (
          <>
            {' '}
            &middot; {copy.mostlyAbout} {topics.join(', ')}
          </>
        ) : null}
      </p>
    </header>
  )
}
