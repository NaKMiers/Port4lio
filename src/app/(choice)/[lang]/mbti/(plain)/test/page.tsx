import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import TestClient from '@/app/(choice)/[lang]/mbti/(plain)/test/TestClient'
import { isLocale, LOCALES } from '@/lib/i18n'
import { getQuestionContent, UI } from '@/lib/mbti/content'
import { QUESTIONS } from '@/lib/mbti/questions'

/**
 * The questionnaire route.
 *
 * Static: the questions are compiled in, so the whole 60-question payload ships with the
 * page and the test runs without another round trip. Only the final submit touches the
 * server.
 *
 * `noindex` because there is nothing here for a search engine - the indexable surface is
 * the landing page and the 16 type pages. An indexed test page competes with them for the
 * same query and gives the searcher a worse landing experience.
 */
export const dynamic = 'force-static'

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}

  return {
    title: UI[lang].startTest,
    robots: { index: false, follow: true },
  }
}

export default async function MbtiTestPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const copy = UI[lang]

  // Only the wording crosses to the client. `axis` stays on the server: shipping it would
  // let anyone read which answer scores which letter straight out of the page source.
  const questions = QUESTIONS.map(question => ({
    id: question.id,
    ...getQuestionContent(lang, question.id),
  }))

  return (
    <main className='mx-auto w-full max-w-2xl px-gutter'>
      <TestClient
        locale={lang}
        questions={questions}
        copy={{
          questionProgress: copy.questionProgress,
          back: copy.back,
          submitting: copy.submitting,
          rateLimited: copy.rateLimited,
          genericError: copy.genericError,
        }}
      />
    </main>
  )
}
