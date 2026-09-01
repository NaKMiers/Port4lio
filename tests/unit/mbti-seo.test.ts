import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOCALES } from '@/lib/i18n'
import {
  alternateLanguages,
  breadcrumbJsonLd,
  faqEntries,
  faqJsonLd,
  landingDescription,
  landingTitle,
  priceLine,
  productJsonLd,
  SEO,
  typeDescription,
  typeListJsonLd,
  typeTitle,
  websiteJsonLd,
} from '@/lib/mbti/seo'
import { QUESTION_COUNT } from '@/lib/mbti/questions'
import { MBTI_TYPES } from '@/lib/mbti/types'
import { personEntityId } from '@/lib/structured-data'

/**
 * Search metadata and structured data.
 *
 * These are cheap tests for something with a slow feedback loop: a malformed JSON-LD block
 * or a description with an unfilled `{price}` placeholder is invisible in the browser and
 * only shows up weeks later as a page that never ranked.
 */

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.com')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('metadata copy', () => {
  it('fills every placeholder in both locales, free and paid', () => {
    for (const locale of LOCALES) {
      for (const price of [0, 2000]) {
        const strings = [
          landingTitle(locale, price),
          landingDescription(locale, price),
          typeDescription(locale, 'INFJ', price),
        ]
        for (const value of strings) {
          // An unreplaced `{price}` renders literally in a search result.
          expect(value, `${locale} @ ${price}`).not.toMatch(/\{[a-z]+\}/)
          expect(value.length).toBeGreaterThan(20)
        }
      }
    }
  })

  it('keeps descriptions inside the length Google will actually render', () => {
    // Google truncates around 155-160 characters. An earlier version of this test allowed
    // 320, which passed happily while the live descriptions ran to 226 and had their tail
    // cut off in the SERP - so the bound is the real one now.
    for (const locale of LOCALES) {
      for (const price of [0, 2000, 50_000]) {
        expect(landingDescription(locale, price).length, `${locale} landing @ ${price}`).toBeLessThanOrEqual(160)
        expect(
          typeDescription(locale, 'INFJ', price).length,
          `${locale} type @ ${price}`
        ).toBeLessThanOrEqual(160)
      }
    }
  })

  it('puts the price inside the part of the description that survives truncation', () => {
    // The price is the whole competitive claim. At the end of a 226-character description
    // it was written for nobody.
    for (const locale of LOCALES) {
      const description = landingDescription(locale, 2000)
      expect(description.indexOf('2.000₫'), `${locale}`).toBeLessThan(100)
    }
  })

  it('leads with the price when there is one, and with free when there is not', () => {
    expect(priceLine('vi', 0)).toContain('miễn phí')
    expect(priceLine('vi', 2000)).toContain('2.000₫')
    expect(priceLine('en', 2000)).toContain('2.000₫')
  })

  it('makes no unprovable superlative claim', () => {
    // Deliberate: Google does not reward superlatives in meta text, and Vietnam's
    // advertising law restricts unsubstantiated "nhất" claims. The price is the
    // differentiator and it is verifiable.
    for (const locale of LOCALES) {
      const all = [
        landingTitle(locale, 2000),
        landingDescription(locale, 2000),
        typeTitle(locale, 'INFJ'),
        typeDescription(locale, 'INFJ', 2000),
      ].join(' ')
      expect(all).not.toMatch(/chính xác nhất|rẻ nhất|tốt nhất|số 1|most accurate|cheapest|best ever/i)
    }
  })

  it('names the question count from the source of truth', () => {
    expect(landingDescription('vi', 0)).toContain(String(QUESTION_COUNT))
  })
})

describe('hreflang', () => {
  it('includes every locale plus an x-default pointing at Vietnamese', () => {
    const languages = alternateLanguages(locale => `/${locale}/mbti`)

    for (const locale of LOCALES) {
      expect(languages[locale]).toBe(`/${locale}/mbti`)
    }
    // Without x-default a crawler picks arbitrarily for everyone else; Vietnamese is the
    // primary audience.
    expect(languages['x-default']).toBe('/vi/mbti')
  })
})

describe('structured data', () => {
  it('prices the offer in dong, as a number a crawler can read', () => {
    const product = productJsonLd('vi', 2000) as {
      offers: { price: string; priceCurrency: string }
    }
    expect(product.offers.price).toBe('2000')
    // Omitting the currency makes 2000 read as two thousand dollars.
    expect(product.offers.priceCurrency).toBe('VND')
  })

  it('still emits a valid offer when results are free', () => {
    const product = productJsonLd('vi', 0) as { offers: { price: string } }
    expect(product.offers.price).toBe('0')
  })

  it('builds absolute breadcrumb URLs in order', () => {
    const crumbs = breadcrumbJsonLd('vi', [
      { name: 'Trang chủ', path: '/' },
      { name: 'MBTI', path: '/vi/mbti' },
    ]) as { itemListElement: { position: number; item: string }[] }

    expect(crumbs.itemListElement.map(c => c.position)).toEqual([1, 2])
    // Relative URLs are ignored by Google in BreadcrumbList.
    expect(crumbs.itemListElement[1].item).toBe('https://example.com/vi/mbti')
  })

  it('lists all sixteen types with absolute URLs', () => {
    const list = typeListJsonLd('vi', MBTI_TYPES) as {
      numberOfItems: number
      itemListElement: { url: string }[]
    }
    expect(list.numberOfItems).toBe(16)
    expect(list.itemListElement).toHaveLength(16)
    expect(list.itemListElement.every(i => i.url.startsWith('https://example.com/vi/mbti/'))).toBe(true)
  })

  it('produces a question and a non-empty answer for every FAQ entry', () => {
    for (const locale of LOCALES) {
      const faq = faqJsonLd(locale, 2000) as {
        mainEntity: { name: string; acceptedAnswer: { text: string } }[]
      }
      expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5)
      for (const entry of faq.mainEntity) {
        expect(entry.name.length).toBeGreaterThan(8)
        expect(entry.acceptedAnswer.text.length).toBeGreaterThan(20)
      }
    }
  })

  it('tells the truth about price in the FAQ, in both modes', () => {
    expect(faqEntries('vi', 0)[0].a).toContain('miễn phí')
    expect(faqEntries('vi', 2000)[0].a).toContain('2.000₫')
  })

  it('attributes the MBTI section to the site-wide Person entity', () => {
    // The only link between this product and the portfolio, and it is invisible to
    // visitors by design. If the `@id` ever stops matching the one the homepage declares,
    // Google sees two unrelated properties on one domain and splits authority between
    // them - which is exactly the opposite of the point, and nothing on screen would look
    // wrong.
    const site = websiteJsonLd('vi') as { publisher: { '@id': string } }
    expect(site.publisher['@id']).toBe(personEntityId('https://example.com'))
  })

  it('serialises to JSON without throwing', () => {
    // Anything non-serialisable here renders an empty script tag and fails silently.
    for (const locale of LOCALES) {
      expect(() => JSON.stringify(productJsonLd(locale, 2000))).not.toThrow()
      expect(() => JSON.stringify(faqJsonLd(locale, 2000))).not.toThrow()
    }
  })
})

describe('keyword targeting', () => {
  it('leads Vietnamese keywords with the highest-volume query shape', () => {
    expect(SEO.vi.keywords[0]).toBe('trắc nghiệm mbti')
    expect(SEO.vi.keywords).toContain('mbti tiếng việt')
  })
})
