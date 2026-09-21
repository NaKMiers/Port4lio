import { LOCALES, type Locale } from '@/lib/i18n'
import { ITEM_COUNT } from '@/lib/iq/items/config'
import { breadcrumbJsonLd, priceLine, siteOrigin } from '@/lib/mbti/seo'
import { TEST_DURATION_SECONDS } from '@/lib/iq/scoring'
import { personEntityId, websiteEntityId } from '@/lib/structured-data'

/**
 * IQ structured data and hreflang.
 *
 * Reuses `siteOrigin()` from the MBTI SEO module rather than redefining it - that function
 * refuses to guess a canonical origin in production and throws instead, which is behaviour
 * worth having exactly once.
 *
 * Deliberately smaller than `lib/mbti/seo.ts`. MBTI has 16 type pages each wanting an
 * Article and its own FAQ; IQ has two indexable pages, so anything more would be structure
 * for its own sake.
 */

type JsonLdValue = Record<string, unknown>

const MINUTES = Math.round(TEST_DURATION_SECONDS / 60)

/**
 * `{price}` is filled at render time from `priceLine()`, never written into the string.
 *
 * The description is what appears under the result in search, and it is the one place a
 * wrong claim about cost is both highly visible and impossible to notice from the code.
 * Interpolating means flipping `IQ_RESULT_PRICE` cannot leave "free" in a snippet.
 *
 * Note that `priceLine` names no figure when the result is paid - the amount is not
 * disclosed anywhere before the result page. See its own doc comment for why.
 */
export const IQ_SEO = {
  vi: {
    name: 'Test IQ online',
    description: `Bài trắc nghiệm IQ bằng hình ảnh, ${ITEM_COUNT} câu trong ${MINUTES} phút. {price}. Không cần đăng ký, đề sinh riêng cho từng lượt làm.`,
    keywords: [
      'test iq',
      'trắc nghiệm iq',
      'kiểm tra iq',
      'iq test online',
      'test iq miễn phí',
    ],
  },
  en: {
    name: 'Online IQ test',
    description: `A visual reasoning IQ test, ${ITEM_COUNT} questions in ${MINUTES} minutes. {price}. No signup, and the questions are generated per attempt.`,
    keywords: [
      'iq test',
      'online iq test',
      'free iq test',
      'visual reasoning test',
    ],
  },
} as const

/** The description with the price resolved. Used for `<meta>` and for the JSON-LD alike. */
export function iqDescription(locale: Locale, price: number): string {
  return IQ_SEO[locale].description.replace('{price}', priceLine(locale, price))
}

/**
 * `hreflang` pairs. `x-default` points at Vietnamese because that is the primary audience;
 * a crawler with no language preference should land there rather than on English.
 */
export function alternateIqLanguages(
  path: (locale: Locale) => string
): Record<string, string> {
  const languages: Record<string, string> = {}
  for (const locale of LOCALES) languages[locale] = path(locale)
  languages['x-default'] = path('vi')
  return languages
}

export function iqLandingJsonLd(locale: Locale, price: number): JsonLdValue {
  const origin = siteOrigin()
  const seo = IQ_SEO[locale]
  return {
    '@context': 'https://schema.org',
    '@type': 'Quiz',
    name: seo.name,
    description: iqDescription(locale, price),
    url: `${origin}/${locale}/iq`,
    inLanguage: locale,
    educationalLevel: 'general',
    numberOfQuestions: ITEM_COUNT,
    timeRequired: `PT${MINUTES}M`,
    // Taking the test is free either way; `isAccessibleForFree` describes the RESULT, so it
    // stays truthful in both modes.
    //
    // No `offers` block when paid, deliberately: an Offer carrying `price` is exactly how a
    // figure reaches a search result, and the amount is not disclosed before someone
    // finishes the test. Saying the result is not free without naming the number is the
    // honest half of that, and it is the half a crawler needs.
    isAccessibleForFree: price <= 0,
    /**
     * Ties the Quiz to the site's existing Person and WebSite nodes.
     *
     * Without these two lines the IQ test was a free-floating entity: Google had a Quiz on
     * one hand and, from `/` and `/cv`, a Person and a WebSite on the other, with nothing
     * saying they were related. The MBTI section has always pointed at the Person through
     * `websiteJsonLd`; IQ was added later and never did, so it was the one product on the
     * domain accruing no authority to the site it belongs to.
     */
    publisher: { '@id': personEntityId(origin) },
    isPartOf: { '@id': websiteEntityId(origin) },
  }
}

/**
 * Breadcrumb trail for an IQ page.
 *
 * A thin pass-through to the MBTI module's builder, which is product-agnostic despite
 * where it lives. Wrapped rather than imported directly by the IQ pages so that they keep
 * importing their SEO from one place, and so that the day these two sections stop agreeing
 * about breadcrumb shape, the split has somewhere to happen.
 *
 * Worth having on both IQ pages for the same reason it is on the MBTI ones: Google renders
 * the trail in place of the raw URL in a result, and `anhkhoa.info › IQ › How scoring
 * works` earns a click that `anhkhoa.info/vi/iq/method` does not.
 */
export function iqBreadcrumbJsonLd(
  locale: Locale,
  trail: { name: string; path: string }[]
): JsonLdValue {
  return breadcrumbJsonLd(locale, trail)
}

/**
 * `/[lang]/iq/method` as a page about the test.
 *
 * This page had no structured data at all, while sitting in the sitemap at priority 0.6 on
 * the strength of "how is this scored" being a genuine search.
 *
 * `WebPage` and not `FAQPage`, deliberately, even though the page is a list of headings
 * with answers under them. Some of those headings are questions ("How the score is
 * calculated") but others are plain labels ("The band table"), and marking a mixed list up
 * as question-and-answer pairs is a misrepresentation of the page - the kind that earns a
 * structured-data manual action rather than a rich result. The honest type still buys the
 * two things worth having: `about` names what the page explains, so the method page and the
 * Quiz reinforce each other instead of competing for the same query, and `isPartOf` folds
 * it into the site graph.
 */
export function iqMethodJsonLd(
  locale: Locale,
  title: string,
  description: string
): JsonLdValue {
  const origin = siteOrigin()

  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: `${origin}/${locale}/iq/method`,
    inLanguage: locale,
    about: {
      '@type': 'Quiz',
      name: IQ_SEO[locale].name,
      url: `${origin}/${locale}/iq`,
    },
    publisher: { '@id': personEntityId(origin) },
    isPartOf: { '@id': websiteEntityId(origin) },
  }
}

/**
 * FAQ entries. Written to answer what people actually search, and honest about the limits -
 * "is this accurate" gets the real answer, not a reassuring one, because the same claim is
 * on `/iq/method` and the two must not disagree.
 */
export function iqFaqEntries(
  locale: Locale,
  price: number
): { q: string; a: string }[] {
  // The cost question, answered from config rather than from written-in copy. Whoever reads
  // this is deciding whether to spend 24 minutes, so it has to be true - which means saying
  // a paid unlock exists even though the figure itself is held back until they finish.
  const priceAnswer =
    price <= 0
      ? locale === 'vi'
        ? 'Không. Bài test và kết quả đầy đủ đều miễn phí, không cần đăng ký.'
        : 'No. The test and the full result are both free, with no signup.'
      : locale === 'vi'
        ? 'Làm bài thì miễn phí, không cần đăng ký. Mở kết quả đầy đủ là tùy chọn có trả phí - đã bao gồm chứng nhận công khai mang tên bạn - và mức giá hiện ngay trên trang kết quả sau khi bạn làm xong.'
        : 'Taking the test is free, with no signup. Opening the full result is an optional paid unlock - it includes the public certificate in your name - and the price is shown on your result page once you finish.'

  if (locale === 'vi')
    return [
      {
        q: 'Bài test IQ này có mất phí không?',
        a: priceAnswer,
      },
      {
        q: 'Bài test mất bao lâu?',
        a: `${ITEM_COUNT} câu trong ${MINUTES} phút. Đồng hồ được tính ở phía máy chủ nên không thể tạm dừng.`,
      },
      {
        q: 'Kết quả có chính xác không?',
        a: 'Đây là bài test sàng lọc, không phải đánh giá lâm sàng. Điểm được ánh xạ từ số câu đúng sang một dải điểm trên thang quy ước, và thang này hiện là tạm thời. Trang "Cách tính điểm" giải thích đầy đủ.',
      },
      {
        q: 'Mỗi lần làm có giống nhau không?',
        a: 'Không. Đề được sinh riêng cho từng lượt làm, nên không có bộ đáp án chung để tra.',
      },
    ]

  return [
    {
      q: 'Is this IQ test free?',
      a: priceAnswer,
    },
    {
      q: 'How long does it take?',
      a: `${ITEM_COUNT} questions in ${MINUTES} minutes. The clock runs on the server, so it cannot be paused.`,
    },
    {
      q: 'Is the result accurate?',
      a: 'It is a screening test, not a clinical assessment. The score maps your number of correct answers onto a band on the conventional scale, and that scale is currently provisional. The "How scoring works" page explains this in full.',
    },
    {
      q: 'Is the test the same every time?',
      a: 'No. The questions are generated per attempt, so there is no shared answer key to look up.',
    },
  ]
}

export function iqFaqJsonLd(locale: Locale, price: number): JsonLdValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: iqFaqEntries(locale, price).map(entry => ({
      '@type': 'Question',
      name: entry.q,
      acceptedAnswer: { '@type': 'Answer', text: entry.a },
    })),
  }
}
