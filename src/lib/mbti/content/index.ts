import { QUESTIONS_EN } from '@/lib/mbti/content/questions.en'
import { QUESTIONS_VI } from '@/lib/mbti/content/questions.vi'
import type { QuestionContent, TypeContent } from '@/lib/mbti/content/types'
import { TYPES_EN } from '@/lib/mbti/content/types.en'
import { TYPES_VI } from '@/lib/mbti/content/types.vi'
import type { Locale } from '@/lib/i18n'
import type { MbtiType } from '@/lib/mbti/types'

/**
 * The one place a locale turns into content.
 *
 * Adding a third language is: two new content files, two lines in each record below, one
 * entry in `LOCALES`. Nothing else in the app switches on locale.
 */

const QUESTION_CONTENT: Record<Locale, Record<number, QuestionContent>> = {
  vi: QUESTIONS_VI,
  en: QUESTIONS_EN,
}

const TYPE_CONTENT: Record<Locale, Record<MbtiType, TypeContent>> = {
  vi: TYPES_VI,
  en: TYPES_EN,
}

export function getQuestionContent(locale: Locale, id: number): QuestionContent {
  const content = QUESTION_CONTENT[locale][id]
  if (!content) {
    // A structural question with no wording is a build-time authoring bug, not a runtime
    // condition to degrade around. Failing here beats rendering a blank question.
    throw new Error(`Missing ${locale} content for question ${id}`)
  }
  return content
}

export function getTypeContent(locale: Locale, type: MbtiType): TypeContent {
  return TYPE_CONTENT[locale][type]
}

/**
 * Interface copy: everything that is not a question or a type description.
 *
 * Small enough to live inline rather than in per-locale files - splitting it would mean
 * three files to touch for every new button label.
 */
export const UI = {
  vi: {
    brand: 'MBTI',
    /**
     * The visible `<h1>`. Distinct from the `<title>` in `lib/mbti/seo.ts`, which is
     * written for a search result rather than for the page.
     *
     * It leads with the keyword on purpose. An earlier version was just the question,
     * which is better hero copy but contained neither "trắc nghiệm" nor "MBTI" - and the
     * h1 is one of the strongest on-page signals for what a page is about. Keeping the
     * question after the colon keeps the hook.
     */
    landingTitle: 'Trắc nghiệm MBTI: bạn hiểu rõ tính cách của mình tới đâu?',
    landingLead:
      'Bài trắc nghiệm 60 câu dựa trên bốn cặp đối lập. Miễn phí, không cần tài khoản, không cần để lại email.',
    landingAxes: [
      'Hướng ngoại - Hướng nội (E-I)',
      'Giác quan - Trực giác (S-N)',
      'Lý trí - Cảm xúc (T-F)',
      'Nguyên tắc - Linh hoạt (J-P)',
    ],
    startTest: 'Làm bài trắc nghiệm',
    /** `{count}` is filled from `QUESTION_COUNT` so the number cannot drift from the test. */
    testMeta: '{count} câu - khoảng 8 phút',
    allTypes: '16 nhóm tính cách',
    allTypesLead: 'Bốn nhóm khí chất, mỗi nhóm bốn kiểu tính cách.',
    faqTitle: 'Câu hỏi thường gặp',
    relatedTypes: 'Các nhóm cùng khí chất',
    onThisPage: 'Nội dung trang',
    lettersTitle: 'Ý nghĩa từng chữ cái',
    /** `{type}` is the four-letter code. */
    lettersLead: 'Bốn chữ cái trong {type} tương ứng với bốn cặp đối lập.',
    functionsTitle: 'Hàm nhận thức',
    functionsLead:
      'Theo lý thuyết MBTI, mỗi nhóm tính cách dùng bốn hàm nhận thức theo một thứ tự cố định. Thứ tự này giải thích vì sao hai nhóm chỉ khác một chữ cái lại vận hành rất khác nhau.',
    groupLabels: {
      NT: 'Nhà phân tích',
      NF: 'Nhà ngoại giao',
      SJ: 'Người gìn giữ',
      SP: 'Nhà thám hiểm',
    },
    /**
     * A template with `{current}` / `{total}` placeholders, not a function.
     *
     * This string is handed to a Client Component, and functions are not serializable
     * across that boundary. A template keeps the whole sentence in the translator's hands
     * (Vietnamese and English put the number in different places) without smuggling code
     * into the payload.
     */
    questionProgress: 'Câu {current}/{total}',
    back: 'Quay lại câu trước',
    submitting: 'Đang chấm điểm...',
    resultTitle: 'Kết quả của bạn',
    yourType: 'Nhóm tính cách của bạn',
    strengths: 'Điểm mạnh',
    growth: 'Điều đáng lưu ý',
    inRelationships: 'Trong các mối quan hệ',
    readFullType: 'Đọc đầy đủ về',
    retake: 'Làm lại bài test',
    /** `{days}` comes from `ATTEMPT_TTL_DAYS`, so the promise cannot drift from the TTL index. */
    resultKeepLink:
      'Lưu lại đường dẫn này. Đây là cách duy nhất để quay lại kết quả của bạn, và nó sẽ hết hạn sau {days} ngày.',
    axisBreakdown: 'Chi tiết từng cặp',
    notFoundTitle: 'Không tìm thấy',
    notFoundBody: 'Đường dẫn này không tồn tại hoặc đã hết hạn.',
    backToStart: 'Về trang MBTI',
    privacy: 'Chính sách bảo mật',
    rateLimited: 'Bạn thao tác hơi nhanh. Vui lòng thử lại sau một lát.',
    genericError: 'Có lỗi xảy ra. Vui lòng thử lại.',

    // Paywall. Only rendered when MBTI_RESULT_PRICE is set above the PayOS minimum.
    paywallTitle: 'Mở khóa kết quả đầy đủ',
    /** `{price}` is filled from the configured amount, formatted in đồng. */
    paywallLead:
      'Bạn đã biết nhóm tính cách của mình. Bản đầy đủ gồm chi tiết từng cặp, phân tích sâu, điểm mạnh, điều cần lưu ý và cách bạn thể hiện trong các mối quan hệ - {price}.',
    paywallLocked: 'Phần này sẽ mở sau khi thanh toán',
    emailLabel: 'Email nhận kết quả',
    emailPlaceholder: 'ban@example.com',
    emailHint: 'Chúng tôi chỉ dùng email này để gửi kết quả cho bạn.',
    payButton: 'Thanh toán',
    payPreparing: 'Đang tạo mã thanh toán...',
    payScanTitle: 'Quét mã để thanh toán',
    payScanLead: 'Mở app ngân hàng và quét mã QR bên dưới.',
    payManualTitle: 'Hoặc chuyển khoản thủ công',
    payBank: 'Ngân hàng',
    payAccountNumber: 'Số tài khoản',
    payAccountName: 'Chủ tài khoản',
    payAmount: 'Số tiền',
    payTransferNote: 'Nội dung chuyển khoản',
    payTransferWarning:
      'Chuyển đúng nội dung ở trên, nếu không hệ thống không thể đối chiếu giao dịch của bạn.',
    payWaiting: 'Đang chờ thanh toán...',
    payDone: 'Đã nhận thanh toán. Đang mở kết quả...',
    payCancelled: 'Giao dịch đã hết hạn hoặc bị hủy. Vui lòng thử lại.',
    payExpiresIn: 'Mã thanh toán còn hiệu lực',
    payExpired: 'Mã thanh toán đã hết hạn.',
    payRetry: 'Tạo mã thanh toán mới',
    /** `{email}` is the address the buyer just entered. */
    payDeliveryNote:
      'Kết quả sẽ hiện ngay trên trang này sau khi thanh toán, đồng thời được gửi tới {email}. Vui lòng không rời khỏi trang trong lúc chờ.',
    copy: 'Sao chép',
    copied: 'Đã sao chép',
    invalidEmail: 'Email không hợp lệ.',
  },
  en: {
    brand: 'MBTI',
    /** See the Vietnamese entry: keyword first, hook after the colon. */
    landingTitle: 'MBTI personality test: how well do you actually know yourself?',
    landingLead:
      'A 60-question test across four opposing pairs. Free, no account, no email required.',
    landingAxes: [
      'Extraversion - Introversion (E-I)',
      'Sensing - Intuition (S-N)',
      'Thinking - Feeling (T-F)',
      'Judging - Perceiving (J-P)',
    ],
    startTest: 'Take the test',
    /** See the Vietnamese entry: `{count}` comes from `QUESTION_COUNT`. */
    testMeta: '{count} questions - about 8 minutes',
    allTypes: 'All 16 types',
    allTypesLead: 'Four temperament groups, four types in each.',
    faqTitle: 'Frequently asked questions',
    relatedTypes: 'Others in this group',
    onThisPage: 'On this page',
    lettersTitle: 'What each letter means',
    /** `{type}` is the four-letter code. */
    lettersLead: 'The four letters in {type} map to four opposing pairs.',
    functionsTitle: 'Cognitive functions',
    functionsLead:
      'In MBTI theory each type uses four cognitive functions in a fixed order. That order is why two types differing by a single letter can operate so differently.',
    groupLabels: {
      NT: 'Analysts',
      NF: 'Diplomats',
      SJ: 'Sentinels',
      SP: 'Explorers',
    },
    /** See the note on the Vietnamese entry: a template, because functions cannot cross to the client. */
    questionProgress: 'Question {current} of {total}',
    back: 'Back to previous question',
    submitting: 'Scoring...',
    resultTitle: 'Your result',
    yourType: 'Your type',
    strengths: 'Strengths',
    growth: 'Worth watching',
    inRelationships: 'In relationships',
    readFullType: 'Read more about',
    retake: 'Take the test again',
    /** See the Vietnamese entry: `{days}` comes from `ATTEMPT_TTL_DAYS`. */
    resultKeepLink:
      'Keep this link. It is the only way back to your result, and it expires after {days} days.',
    axisBreakdown: 'Axis breakdown',
    notFoundTitle: 'Not found',
    notFoundBody: 'This link does not exist, or it has expired.',
    backToStart: 'Back to MBTI',
    privacy: 'Privacy',
    rateLimited: 'That was a bit fast. Please try again in a moment.',
    genericError: 'Something went wrong. Please try again.',

    // Paywall. Only rendered when MBTI_RESULT_PRICE is set above the PayOS minimum.
    paywallTitle: 'Unlock the full result',
    /** `{price}` is filled from the configured amount, formatted in đồng. */
    paywallLead:
      'You already know your type. The full result adds the axis breakdown, the deeper read, your strengths, what to watch for, and how you show up in relationships - {price}.',
    paywallLocked: 'Unlocks after payment',
    emailLabel: 'Email for your result',
    emailPlaceholder: 'you@example.com',
    emailHint: 'Used only to send you the result.',
    payButton: 'Pay',
    payPreparing: 'Creating your payment...',
    payScanTitle: 'Scan to pay',
    payScanLead: 'Open your banking app and scan the QR code below.',
    payManualTitle: 'Or transfer manually',
    payBank: 'Bank',
    payAccountNumber: 'Account number',
    payAccountName: 'Account name',
    payAmount: 'Amount',
    payTransferNote: 'Transfer description',
    payTransferWarning:
      'Send exactly the description above, or the transfer cannot be matched to your result.',
    payWaiting: 'Waiting for your payment...',
    payDone: 'Payment received. Opening your result...',
    payCancelled: 'That payment expired or was cancelled. Please try again.',
    payExpiresIn: 'Payment code valid for',
    payExpired: 'This payment code has expired.',
    payRetry: 'Create a new payment code',
    /** `{email}` is the address the buyer just entered. */
    payDeliveryNote:
      'Your result will appear on this page as soon as the payment lands, and a copy goes to {email}. Please stay on this page while you pay.',
    copy: 'Copy',
    copied: 'Copied',
    invalidEmail: 'That email address is not valid.',
  },
} as const
