import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale } from '@/lib/i18n'
import { BAND_LABELS, fill, iqUi } from '@/lib/iq/content'
import { connectDatabase } from '@/lib/mongodb'
import { isTokenShaped } from '@/lib/tokens'
import { IqAttemptModel } from '@/models/IqAttempt'

/**
 * Certificate verification.
 *
 * The reason a certificate is worth anything: a stranger can check it. Without this page a
 * certificate is a picture, and a picture of a number is trivially faked in any image
 * editor.
 *
 * Answers exactly one question - does this id correspond to a real, completed test - and
 * shows only what the certificate already shows. It deliberately reveals nothing more: not
 * the answers, not the attempt token, not how long it took. Verification is not a reason to
 * expose more than the artifact being verified.
 *
 * A malformed or unknown id renders a plain "no such certificate" rather than a 404,
 * because "this does not verify" is the useful answer to someone checking a forgery, and a
 * 404 reads as a broken site.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}

  return {
    title: iqUi(lang).verifyThis,
    /**
     * `noindex`, matching every other page on this site whose URL contains a token.
     *
     * This was the one that got missed. The page declared no `robots` at all, no layout
     * above it supplies one, so it inherited the root layout's `index: true` and shipped as
     * `index, follow` while `/iq/result/[id]`, `/iq/certificate/[id]` and both test pages
     * were all `noindex`. `sitemap.ts` already documents the intent - verify URLs are
     * "deliberately absent" because one "only means anything to someone holding the id" -
     * but leaving a page out of the sitemap does not keep it out of the index. Crawlers
     * reach URLs by following links, and an indexed verification page publishes the
     * certificate id in its URL to anyone searching.
     *
     * `follow` is kept: the page links back to `/[lang]/iq`, and there is no reason to
     * throw away that internal link signal to protect the id, which `index: false` already
     * handles.
     */
    robots: { index: false, follow: true },
  }
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>
}) {
  const { lang, id } = await params
  if (!isLocale(lang)) notFound()

  const copy = iqUi(lang)

  // Shape-check before the query so a scan never becomes a database round trip. An
  // ill-formed id is simply not a certificate, which is the same answer as an unknown one.
  const attempt = isTokenShaped(id)
    ? await connectDatabase().then(() => IqAttemptModel.findOne({ certificateId: id }).lean())
    : null

  const valid = Boolean(attempt?.certificateName && attempt?.score !== null)

  return (
    <main>
      <SectionFrame className='py-section-sm' innerClassName='max-w-2xl'>
        <EditorialPanel variant='strong' className='p-8 text-center md:p-10'>
          {valid && attempt ? (
            <>
              <p
                className='font-display text-sm font-semibold uppercase tracking-[0.2em]'
                style={{ color: '#2e8fae' }}
              >
                {copy.certificateVerified}
              </p>
              <p className='mt-6 font-display text-xl font-semibold text-pp-text'>
                {attempt.certificateName}
              </p>
              <p className='mt-4 font-display text-5xl font-semibold tabular-nums text-pp-text'>
                {attempt.score}
              </p>
              <p className='mt-2 text-pp-muted'>
                {BAND_LABELS[lang][attempt.band ?? ''] ?? attempt.band}
                {' · '}
                {fill(copy.percentileLabel, { percentile: attempt.percentile ?? 0 })}
              </p>
              <p className='mt-6 font-mono text-xs text-pp-muted'>{id}</p>
            </>
          ) : (
            <p className='text-pp-muted'>{copy.certificateNotFound}</p>
          )}
        </EditorialPanel>

        <div className='mt-8 text-center text-sm'>
          <Link
            href={`/${lang}/iq`}
            className='font-semibold text-pp-text underline decoration-pp-blue/50 underline-offset-[0.2em] hover:decoration-pp-blue'
          >
            {copy.startTest}
          </Link>
        </div>
      </SectionFrame>
    </main>
  )
}
