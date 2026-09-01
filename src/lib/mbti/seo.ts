import { LOCALES, type Locale } from '@/lib/i18n'
import { getTypeContent } from '@/lib/mbti/content'
import { getResultPrice } from '@/lib/mbti/pricing'
import { QUESTION_COUNT } from '@/lib/mbti/questions'
import { FUNCTION_COPY, functionStack, lettersOf } from '@/lib/mbti/theory'
import { groupOfType, slugFromType, type MbtiType } from '@/lib/mbti/types'
import { resolveSiteOrigin } from '@/lib/seo'
import { personEntityId } from '@/lib/structured-data'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * Search metadata and structured data for the MBTI section.
 *
 * Vietnamese is the primary market, so `vi` copy is written first and English is the
 * translation - the reverse of how the rest of this codebase reads. Vietnamese search
 * queries for this are overwhelmingly "trắc nghiệm mbti", "test mbti", "mbti miễn phí",
 * and the sixteen type codes, so those phrases lead the titles.
 *
 * Every claim here is one the site can actually back:
 * - the price is read from config, not written into the copy
 * - "chi tiết" and the question count describe what is measurably there
 * - no unprovable superlative ("chính xác nhất", "tốt nhất"), which Google does not reward
 *   in meta text and which Luật Quảng cáo art. 8.11 restricts without substantiation
 */

export function siteOrigin(): string {
  return resolveSiteOrigin().replace(/\/$/, '')
}

/** `2000` -> `"2.000₫"`. Duplicated from pricing's formatter to keep this module server-safe. */
function dong(amount: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}₫`
}

/**
 * How the offer is described, in prose, for a given price.
 *
 * Free and paid need genuinely different pitches: "miễn phí" is the strongest word in the
 * category and should lead when it is true, while a paid page leads on how small the number
 * is. Reading the price at render time means the copy cannot advertise the wrong one.
 */
export function priceLine(locale: Locale, price: number): string {
  if (price <= 0) {
    return locale === 'vi' ? 'Hoàn toàn miễn phí' : 'Completely free'
  }
  return locale === 'vi' ? `Chỉ ${dong(price)} mỗi kết quả` : `Only ${dong(price)} per result`
}

export const SEO = {
  vi: {
    siteName: 'Trắc nghiệm MBTI',
    landingTitle: 'Trắc nghiệm MBTI - Bài test tính cách {count} câu',
    /**
     * Under ~155 characters, with the price in the first sentence.
     *
     * Google truncates a description around 155-160 characters, so anything after that is
     * written for nobody. An earlier draft ran to 226 and buried "{price}" at the end -
     * cutting off the exact fact this page is meant to compete on.
     */
    landingDescription:
      'Trắc nghiệm MBTI {count} câu bằng tiếng Việt. {price}. Kết quả chi tiết theo 4 nhóm chỉ số, không cần tài khoản hay email.',
    typeTitle: '{type} - {nickname} | Trắc nghiệm MBTI',
    typeDescription:
      '{type} - {nickname}: điểm mạnh, điều cần lưu ý và cách thể hiện trong công việc, tình cảm. Test MBTI {count} câu. {price}.',
    keywords: [
      'trắc nghiệm mbti',
      'test mbti',
      'mbti tiếng việt',
      'bài test tính cách',
      'trắc nghiệm tính cách',
      'mbti miễn phí',
      '16 nhóm tính cách',
      'test tính cách mbti online',
    ],
    breadcrumbHome: 'Trang chủ',
    breadcrumbMbti: 'Trắc nghiệm MBTI',
  },
  en: {
    siteName: 'MBTI Personality Test',
    landingTitle: 'MBTI Personality Test - {count} questions',
    /** See the Vietnamese entry: under ~155 characters, price in the first sentence. */
    landingDescription:
      'A {count}-question MBTI personality test. {price}. Detailed results across four axes, with no account and no email.',
    typeTitle: '{type} - {nickname} | MBTI Personality Test',
    typeDescription:
      '{type} - {nickname}: strengths, blind spots, and how they show up at work and in relationships. {count}-question MBTI test. {price}.',
    keywords: [
      'mbti test',
      'personality test',
      'mbti personality types',
      '16 personalities',
      'free personality test',
    ],
    breadcrumbHome: 'Home',
    breadcrumbMbti: 'MBTI test',
  },
} as const

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, String(value)),
    template
  )
}

export function landingTitle(locale: Locale, price: number): string {
  return fill(SEO[locale].landingTitle, { count: QUESTION_COUNT, price: priceLine(locale, price) })
}

export function landingDescription(locale: Locale, price: number): string {
  return fill(SEO[locale].landingDescription, {
    count: QUESTION_COUNT,
    price: priceLine(locale, price),
  })
}

export function typeTitle(locale: Locale, type: MbtiType): string {
  return fill(SEO[locale].typeTitle, {
    type,
    nickname: getTypeContent(locale, type).nickname,
  })
}

export function typeDescription(locale: Locale, type: MbtiType, price: number): string {
  return fill(SEO[locale].typeDescription, {
    type,
    nickname: getTypeContent(locale, type).nickname,
    count: QUESTION_COUNT,
    price: priceLine(locale, price),
  })
}

/**
 * `hreflang` map including `x-default`.
 *
 * Without `x-default` a search engine has no instruction for a searcher whose language is
 * neither Vietnamese nor English, and tends to pick one arbitrarily. Pointing it at the
 * Vietnamese page matches the audience this is built for.
 */
export function alternateLanguages(path: (locale: Locale) => string): Record<string, string> {
  return {
    ...Object.fromEntries(LOCALES.map(locale => [locale, path(locale)])),
    'x-default': path('vi'),
  }
}

// MARK: JSON-LD

type JsonLd = Record<string, unknown>

/**
 * The test as a purchasable thing.
 *
 * `Product` rather than a bare `WebPage` because it is the only vocabulary Google reads a
 * price out of, and the price IS the differentiator here. `priceCurrency: 'VND'` matters:
 * omit it and a 2000 reads as two thousand dollars.
 *
 * When results are free the offer is emitted at price 0, which is valid schema and still
 * conveys "no cost" to a crawler.
 */
export function productJsonLd(locale: Locale, price: number): JsonLd {
  const origin = siteOrigin()

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: SEO[locale].siteName,
    description: landingDescription(locale, price),
    url: `${origin}/${locale}/mbti`,
    category: locale === 'vi' ? 'Trắc nghiệm tính cách' : 'Personality assessment',
    offers: {
      '@type': 'Offer',
      price: String(price),
      priceCurrency: 'VND',
      availability: 'https://schema.org/InStock',
      url: `${origin}/${locale}/mbti`,
      // Named explicitly so a crawler does not have to infer that a digital result has no
      // shipping and no return window.
      category: locale === 'vi' ? 'Sản phẩm số' : 'Digital product',
    },
  }
}

/**
 * Identifies the MBTI section, and ties it to the site's existing Person entity.
 *
 * `publisher` pointing at `#person` is the only link between this product and the
 * portfolio, and it is deliberately invisible: the pages carry no "Portfolio" breadcrumb
 * because this is built for strangers, but a search engine seeing two unrelated properties
 * on one domain splits authority between them. Sharing the `@id` merges them into one
 * entity's work without putting anything on screen.
 */
export function websiteJsonLd(locale: Locale): JsonLd {
  const origin = siteOrigin()

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SEO[locale].siteName,
    url: `${origin}/${locale}/mbti`,
    inLanguage: locale === 'vi' ? 'vi-VN' : 'en',
    publisher: { '@id': personEntityId(origin) },
  }
}

/**
 * Trail from the site root to the current page.
 *
 * Google renders these as the breadcrumb line in place of a raw URL, which is a real
 * click-through gain on a path as deep as `/vi/mbti/enfj`.
 */
export function breadcrumbJsonLd(
  locale: Locale,
  trail: { name: string; path: string }[]
): JsonLd {
  const origin = siteOrigin()

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `${origin}${crumb.path}`,
    })),
  }
}

/** One type page as an article about that type. */
export function typeArticleJsonLd(locale: Locale, type: MbtiType): JsonLd {
  const origin = siteOrigin()
  const content = getTypeContent(locale, type)
  const url = `${origin}/${locale}/mbti/${slugFromType(type)}`

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${type} - ${content.nickname}`,
    description: content.tagline,
    articleSection: groupOfType(type),
    inLanguage: locale === 'vi' ? 'vi-VN' : 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
  }
}

/**
 * The FAQ, as both visible content and structured data.
 *
 * Worth being straight about the payoff: Google restricted FAQ rich results to
 * authoritative government and health sites in 2023, so this will almost certainly not
 * render as an expandable snippet. It still earns its place - the answers are real page
 * content targeting real long-tail queries ("mbti có chính xác không", "test mbti mất bao
 * lâu"), and that is what actually ranks.
 */
export function faqEntries(locale: Locale, price: number): { q: string; a: string }[] {
  const priceAnswer =
    price <= 0
      ? locale === 'vi'
        ? 'Hoàn toàn miễn phí. Không cần tài khoản, không cần để lại email.'
        : 'Completely free. No account, no email required.'
      : locale === 'vi'
        ? `Bài trắc nghiệm miễn phí. Bạn chỉ trả ${dong(price)} nếu muốn mở khóa kết quả đầy đủ, và trả một lần cho mỗi kết quả.`
        : `The test is free. You only pay ${dong(price)} to unlock the full result, once per result.`

  if (locale === 'vi') {
    return [
      { q: 'Trắc nghiệm MBTI này có mất phí không?', a: priceAnswer },
      {
        q: 'Bài test mất bao lâu?',
        a: `Khoảng 8 phút cho ${QUESTION_COUNT} câu. Mỗi câu chỉ có hai lựa chọn, bạn chọn phương án gần với mình hơn và không cần suy nghĩ quá lâu.`,
      },
      {
        q: 'Kết quả MBTI có chính xác không?',
        a: 'MBTI mô tả xu hướng, không phải chẩn đoán. Kết quả phản ánh cách bạn tự nhận định tại thời điểm làm bài, và có thể thay đổi theo hoàn cảnh. Hãy dùng nó như một cách để hiểu bản thân rõ hơn, không phải như một nhãn dán cố định.',
      },
      {
        q: 'Tôi có cần tạo tài khoản không?',
        a: 'Không. Bài làm không gắn với tên hay tài khoản nào. Kết quả được lưu ở một đường dẫn ngẫu nhiên mà chỉ người giữ đường dẫn mới mở được.',
      },
      {
        q: 'Kết quả được lưu trong bao lâu?',
        a: `Kết quả tự động bị xóa sau ${ATTEMPT_TTL_DAYS} ngày. Nếu bạn đã mua bản đầy đủ, toàn bộ nội dung cũng được gửi qua email để bạn giữ lại lâu dài.`,
      },
      {
        q: '16 nhóm tính cách MBTI gồm những nhóm nào?',
        a: 'Bốn nhóm khí chất, mỗi nhóm bốn kiểu: Nhà phân tích (INTJ, INTP, ENTJ, ENTP), Nhà ngoại giao (INFJ, INFP, ENFJ, ENFP), Người gìn giữ (ISTJ, ISFJ, ESTJ, ESFJ) và Nhà thám hiểm (ISTP, ISFP, ESTP, ESFP).',
      },
    ]
  }

  return [
    { q: 'Does this MBTI test cost anything?', a: priceAnswer },
    {
      q: 'How long does it take?',
      a: `About 8 minutes for ${QUESTION_COUNT} questions. Each one has two options; pick whichever is closer to you without overthinking it.`,
    },
    {
      q: 'Is the MBTI result accurate?',
      a: 'MBTI describes tendencies, not a diagnosis. The result reflects how you saw yourself while answering, and it can shift with circumstances. Treat it as a way to understand yourself better, not a fixed label.',
    },
    {
      q: 'Do I need an account?',
      a: 'No. An attempt is not tied to a name or an account. The result lives at a random link that only whoever holds it can open.',
    },
    {
      q: 'How long is my result kept?',
      a: `Results are deleted automatically after ${ATTEMPT_TTL_DAYS} days. If you bought the full result, the whole thing is emailed to you as a permanent copy.`,
    },
    {
      q: 'What are the 16 MBTI types?',
      a: 'Four temperament groups of four: Analysts (INTJ, INTP, ENTJ, ENTP), Diplomats (INFJ, INFP, ENFJ, ENFP), Sentinels (ISTJ, ISFJ, ESTJ, ESFJ) and Explorers (ISTP, ISFP, ESTP, ESFP).',
    },
  ]
}

/**
 * FAQ for one type page.
 *
 * Every answer is composed from content already authored for that type plus derived
 * theory - none of it is generic filler, and none of it asserts anything the site cannot
 * back. The questions mirror how people actually search a type code: "ENTJ là gì", "hàm
 * nhận thức INFJ", "điểm yếu của ISFP".
 *
 * Answers summarise rather than repeat the page verbatim. Google requires an FAQ answer to
 * be present on the page, which it is - but restating a whole strengths list twice is
 * padding, and padding is what the helpful-content system looks for.
 */
export function typeFaqEntries(locale: Locale, type: MbtiType): { q: string; a: string }[] {
  const content = getTypeContent(locale, type)
  const letters = lettersOf(locale, type)
  const stack = functionStack(type)
  const dominant = FUNCTION_COPY[locale][stack[0].fn]
  const inferior = FUNCTION_COPY[locale][stack[3].fn]
  const stackLine = stack.map(entry => entry.fn).join(' - ')
  const letterLine = letters.map(l => `${l.letter} (${l.name})`).join(', ')

  if (locale === 'vi') {
    return [
      {
        q: `${type} là gì?`,
        a: `${type} - ${content.nickname} - là một trong 16 nhóm tính cách MBTI. Bốn chữ cái viết tắt cho ${letterLine}. ${content.tagline}`,
      },
      {
        q: `Hàm nhận thức của ${type} là gì?`,
        a: `Thứ tự hàm nhận thức của ${type} là ${stackLine}. Hàm chủ đạo là ${dominant.name.toLowerCase()} - ${dominant.summary.toLowerCase()} Hàm kém phát triển nhất là ${inferior.name.toLowerCase()}, thường lộ ra khi bạn căng thẳng.`,
      },
      {
        q: `Điểm mạnh của ${type} là gì?`,
        a: `${content.strengths.slice(0, 3).join('; ')}.`,
      },
      {
        q: `${type} cần lưu ý điều gì?`,
        a: `${content.growth.slice(0, 3).join('; ')}.`,
      },
      {
        q: `${type} trong các mối quan hệ thì thế nào?`,
        a: content.inRelationships,
      },
    ]
  }

  return [
    {
      q: `What is ${type}?`,
      a: `${type} - ${content.nickname} - is one of the 16 MBTI personality types. The four letters stand for ${letterLine}. ${content.tagline}`,
    },
    {
      q: `What are the ${type} cognitive functions?`,
      a: `The ${type} function stack is ${stackLine}. The dominant function is ${dominant.name} - ${dominant.summary.toLowerCase()} The least developed is ${inferior.name}, which tends to surface under stress.`,
    },
    {
      q: `What are ${type} strengths?`,
      a: `${content.strengths.slice(0, 3).join('; ')}.`,
    },
    {
      // "an", not "a": every type code begins with E or I, both of which are read as vowel
      // sounds ("an ENTJ", "an INFJ"), so there is no case here that takes "a".
      q: `What should an ${type} watch out for?`,
      a: `${content.growth.slice(0, 3).join('; ')}.`,
    },
    {
      q: `What is ${type} like in relationships?`,
      a: content.inRelationships,
    },
  ]
}

/** Turns any question/answer pair list into `FAQPage` markup. */
export function faqPageJsonLd(entries: { q: string; a: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }
}

export function faqJsonLd(locale: Locale, price: number): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntries(locale, price).map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }
}

/** Every type as an ordered list, so the landing page reads as the index for all 16. */
export function typeListJsonLd(locale: Locale, types: readonly MbtiType[]): JsonLd {
  const origin = siteOrigin()

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: types.length,
    itemListElement: types.map((type, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: `${type} - ${getTypeContent(locale, type).nickname}`,
      url: `${origin}/${locale}/mbti/${slugFromType(type)}`,
    })),
  }
}

export function priceForSeo(): number {
  return getResultPrice()
}
