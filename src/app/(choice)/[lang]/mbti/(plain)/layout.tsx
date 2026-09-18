import { notFound } from 'next/navigation'

import TestProductShell from '@/components/test-kit/TestProductShell'
import { isLocale, LOCALES } from '@/lib/i18n'

/**
 * MBTI's shell, for the pages that must not pitch.
 *
 * The shell and nothing else - no `footerSlot`. See `(pitch)/layout.tsx` beside this for why
 * the two groups exist, and `TestChrome`'s header for what the absence of the slot is
 * protecting: `/[lang]/mbti/test` is a questionnaire, and a "here is who built this, he is
 * open to work" panel next to the answer buttons is an exit, not a footer.
 *
 * `privacy` is here too. It is not harmful there, but it is a page someone opens to check
 * what happens to their data - answering that with a pitch is the wrong note, and the
 * footer already links to it from every page in both groups.
 *
 * `tests/unit/availability-block-absent.test.tsx` asserts the block is absent from the
 * markup this layout produces. A rule enforced only by which directory a file sits in is a
 * rule a directory rename can undo silently.
 */

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export default async function MbtiPlainLayout({
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
