import type { Metadata } from 'next'
import Link from 'next/link'

import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'
import { BLOG_EVENT_TTL_DAYS } from '@/models/PostEvent'
import { resolveSiteOrigin } from '@/lib/seo'

/**
 * `/blog/privacy` - what this site keeps, for how long, and why the answers differ.
 *
 * ## Why this page exists now rather than "eventually"
 *
 * Before the blog there was one retention story and two pages telling it, both scoped to a
 * test: `/[lang]/mbti/privacy` and `/[lang]/iq/privacy`. Both open by promising to list
 * everything that is stored, and both are true about the thing they describe.
 *
 * `ContactMessage` broke that. It holds a name, an email address and free text a stranger
 * typed, it has **no TTL index at all**, and it is written from `/` - a page with no privacy
 * notice of any kind. So there was a collection of correspondence being retained forever,
 * disclosed nowhere, reachable from a form that two other pages point at.
 *
 * ## Why the numbers are interpolated and never typed
 *
 * `tests/unit/retention.test.ts` exists because this exact drift already happened once on
 * this site: the constant moved and the UI copy kept saying 90 days. Its own comment warns
 * that with two windows "the second sentence is the one that goes stale". There are now
 * three regimes, so the risk is higher, and every number below comes from the constant that
 * enforces it. A literal here would be a promise with nothing holding it.
 *
 * The one regime with no constant is `ContactMessage`, because "until I delete it" is not a
 * number - and that is the honest description rather than a gap.
 */

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What this site stores, for how long, and why the answers differ by kind.',
  alternates: { canonical: `${resolveSiteOrigin().replace(/\/$/, '')}/blog/privacy` },
}

export default function BlogPrivacyPage() {
  return (
    <div className='mx-auto w-full max-w-editorial px-gutter py-12'>
      <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'>Privacy</p>
      <h1 className='mt-2 font-display text-3xl font-semibold text-pp-text'>
        What this site keeps
      </h1>
      <p className='mt-4 max-w-[62ch] text-lg leading-relaxed text-pp-muted'>
        Three different kinds of data with three different lifetimes. The difference is not
        arbitrary - a behavioural trace and a message somebody wrote to me are not the same
        thing and should not expire on the same schedule.
      </p>

      <section className='mt-10'>
        <h2 className='font-display text-xl font-semibold text-pp-text'>
          Messages you send me - kept until I delete them
        </h2>
        <p className='mt-2 max-w-[62ch] leading-relaxed text-pp-muted'>
          If you use the contact form, I store your name, email address, subject and message,
          plus whatever you typed into &ldquo;how did you hear about me&rdquo; if you filled it
          in. There is deliberately no expiry on this. It is correspondence: you wrote to a
          person and are waiting for a reply, and a conversation that resumes four months later
          is normal. Expiring it would delete my own inbox on a timer.
        </p>
        <p className='mt-2 max-w-[62ch] leading-relaxed text-pp-muted'>
          It is never shared, never used for a mailing list, and never sold. Ask me to delete a
          message and I will.
        </p>
      </section>

      <section className='mt-8'>
        <h2 className='font-display text-xl font-semibold text-pp-text'>
          If you arrived from a post
        </h2>
        <p className='mt-2 max-w-[62ch] leading-relaxed text-pp-muted'>
          The contact form records which post you came from, when you came from one. That is
          the only reason the blog can tell whether writing anything was worth doing. It is a
          slug - the last part of a post&rsquo;s URL - attached to a message you chose to send,
          and it is stored with that message under the same terms above.
        </p>
      </section>

      <section className='mt-8'>
        <h2 className='font-display text-xl font-semibold text-pp-text'>
          Test results - deleted after {ATTEMPT_TTL_DAYS} days
        </h2>
        <p className='mt-2 max-w-[62ch] leading-relaxed text-pp-muted'>
          The MBTI and IQ tests store your answers and result against a random link, with no
          name and no email, and delete them after {ATTEMPT_TTL_DAYS} days. The counters that
          tell me whether a test is being finished or abandoned are on the same{' '}
          {ATTEMPT_TTL_DAYS}-day clock. The{' '}
          <Link href='/vi/mbti/privacy' className='text-pp-blue no-underline'>
            MBTI
          </Link>{' '}
          and{' '}
          <Link href='/vi/iq/privacy' className='text-pp-blue no-underline'>
            IQ
          </Link>{' '}
          notices cover those in full.
        </p>
      </section>

      <section className='mt-8'>
        <h2 className='font-display text-xl font-semibold text-pp-text'>
          Reading a post - deleted after {BLOG_EVENT_TTL_DAYS} days
        </h2>
        <p className='mt-2 max-w-[62ch] leading-relaxed text-pp-muted'>
          When you open a post I record that a post was read, and if you arrived through
          somebody&rsquo;s shared link, that the link worked. No name, no email, no account,
          no third-party analytics. Your browser tab gets a random id stored in
          sessionStorage - it disappears when you close the tab, and its only job is to stop
          one person refreshing a page from counting as several. All of it is deleted after{' '}
          {BLOG_EVENT_TTL_DAYS} days.
        </p>
        <p className='mt-2 max-w-[62ch] leading-relaxed text-pp-muted'>
          Being honest about the limit of that: the tab id is generated by your browser, so
          these numbers tell me roughly whether writing is worth doing and nothing more. I do
          not treat them as identities and they cannot be joined to a message you send me
          unless you paste a link yourself.
        </p>
      </section>

      <section className='mt-8'>
        <h2 className='font-display text-xl font-semibold text-pp-text'>Not collected</h2>
        <p className='mt-2 max-w-[62ch] leading-relaxed text-pp-muted'>
          No tracking cookies, no advertising pixels, no analytics service, no third parties.
          Blog posts load images from one image host and nothing else - the page&rsquo;s own
          Content-Security-Policy enforces that, so a post cannot quietly fetch something from
          anywhere else even if I made a mistake writing it.
        </p>
      </section>

      <p className='mt-12 text-sm'>
        <Link href='/blog' className='text-pp-muted no-underline hover:text-pp-text'>
          &larr; Writing
        </Link>
      </p>
    </div>
  )
}
