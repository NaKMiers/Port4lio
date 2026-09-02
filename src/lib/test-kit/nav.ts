import type { Locale } from '@/lib/i18n'

/**
 * The tests, for the header nav.
 *
 * One list so the two products cannot disagree about what exists. Adding a third test
 * means one entry here rather than editing two layouts and then discovering months later
 * that one of them never got the link.
 *
 * Labels are intentionally the bare product names rather than sentences. This nav sits
 * beside a locale switcher in a sticky header on mobile, and anything longer wraps.
 */

export const TEST_PRODUCTS = ['mbti', 'iq'] as const

export type TestProduct = (typeof TEST_PRODUCTS)[number]

const LABELS: Record<TestProduct, string> = {
  mbti: 'MBTI',
  iq: 'IQ',
}

export function testNav(locale: Locale): { key: TestProduct; label: string; href: string }[] {
  return TEST_PRODUCTS.map(product => ({
    key: product,
    label: LABELS[product],
    href: `/${locale}/${product}`,
  }))
}
