import { notFound } from 'next/navigation'

import TestProductShell from '@/components/test-kit/TestProductShell'
import { isLocale, LOCALES } from '@/lib/i18n'

/**
 * MBTI's shell.
 *
 * The locale is re-validated rather than trusted: `isLocale` narrows `string` to `Locale`
 * for the shell below, and the parent's check at `[lang]` is not visible to the type system
 * here.
 */

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function MbtiLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  return (
    <TestProductShell locale={lang} product='mbti'>
      {children}
    </TestProductShell>
  )
}
