import { notFound } from 'next/navigation'

import TestProductShell from '@/components/test-kit/TestProductShell'
import { isLocale, LOCALES } from '@/lib/i18n'

/** IQ's shell. See the MBTI layout beside it - the two differ only in the product key. */

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function IqLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  return (
    <TestProductShell locale={lang} product='iq'>
      {children}
    </TestProductShell>
  )
}
