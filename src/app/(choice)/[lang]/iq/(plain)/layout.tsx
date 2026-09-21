import { notFound } from 'next/navigation'

import TestProductShell from '@/components/test-kit/TestProductShell'
import { isLocale, LOCALES } from '@/lib/i18n'

/**
 * IQ's shell, for the pages that must not pitch.
 *
 * The shell and nothing else - no `footerSlot`. `/[lang]/iq/test` is the reason: it is a
 * questionnaire on a 24-minute clock, and it is the single worst page on this site to offer
 * somebody a link away from. See `(pitch)/layout.tsx` beside this for why `method`,
 * `certificate` and `verify` are here as well, and `TestChrome`'s header for the rule.
 */

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function IqPlainLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  return (
    <TestProductShell
      locale={lang}
      product="iq"
    >
      {children}
    </TestProductShell>
  )
}
