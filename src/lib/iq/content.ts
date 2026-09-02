import type { Locale } from '@/lib/i18n'
import { BANDS } from '@/lib/iq/scoring'

/**
 * All IQ interface copy, both locales.
 *
 * One file rather than the split `lib/mbti/content/` layout, because IQ has no per-type
 * essays - the whole product is 26 generated items plus a score. The MBTI split exists to
 * hold 16 type descriptions and 16 career sections; copying that structure here would be
 * folders for the sake of symmetry.
 */

export const IQ_UI = {
  vi: {
    brand: 'IQ',
    landingTitle: 'Test IQ online: bài trắc nghiệm IQ bằng hình ảnh chuẩn quốc tế',
    landingLead:
      '26 câu hỏi hình ảnh, 24 phút. Không cần đăng ký, không cần tài khoản. Đề được sinh riêng cho từng lượt làm.',
    startTest: 'Bắt đầu kiểm tra',
    howItWorks: 'Cách bài test hoạt động',
    /** `{count}` and `{minutes}` are interpolated. */
    howItWorksBody:
      'Mỗi câu là một hình ghép hình học còn thiếu một ô. Bạn chọn ô đúng trong 6 phương án. Có {count} câu, tăng dần độ khó, trong {minutes} phút. Đề được sinh riêng cho mỗi lượt làm, nên không có đáp án chung để tra.',
    methodLink: 'Cách tính điểm',
    privacyLink: 'Bảo mật',
    /**
     * The method-page hook.
     *
     * A plain "Cách tính điểm" link is a footnote nobody clicks. What makes people click
     * is the question they already have - "is this number real?" - asked out loud, plus
     * the admission that most sites inflate. Curiosity plus a small accusation beats a
     * label, and it happens to be the truthful pitch: this IS the page that proves it.
     */
    methodTeaseTitle: 'Điểm này có thật không?',
    methodTeaseBody:
      'Phần lớn trang test IQ cố tình đẩy điểm lên cao, vì người được khen thì chia sẻ nhiều hơn. Chúng tôi không làm vậy - và đây là toàn bộ bảng điểm, cách tính, cùng những gì bài test này KHÔNG làm được.',
    methodTeaseCta: 'Xem cách tính điểm',

    // Test screen
    questionProgress: 'Câu {current} / {total}',
    timeLeft: 'Thời gian còn',
    skip: 'Bỏ qua',
    back: 'Câu trước',
    submitting: 'Đang tính điểm...',
    timeUp: 'Đã hết thời gian. Bài của bạn đang được tính điểm.',
    confirmLeave: 'Bạn đang làm bài test. Rời trang sẽ mất kết quả.',

    // Result screen
    yourScore: 'Chỉ số IQ của bạn',
    percentileLabel: 'Cao hơn {percentile}% dân số',
    rawLabel: 'Trả lời đúng {raw} / {total} câu',
    bandLabel: 'Xếp loại',
    keepLink: 'Lưu lại đường dẫn này. Đây là cách duy nhất để quay lại kết quả, và nó hết hạn sau {days} ngày.',
    retake: 'Làm lại bài test',
    reviewAnswers: 'Xem lại từng câu',
    correct: 'Đúng',
    incorrect: 'Sai',
    skipped: 'Bỏ qua',
    yourAnswer: 'Bạn chọn',
    theAnswer: 'Đáp án',

    // Certificate
    certificateTitle: 'Chứng nhận kết quả',
    certificateLead:
      'Chứng nhận công khai có tên bạn, điểm và phân vị - dùng để chia sẻ và để người khác kiểm chứng.',
    certificateNameLabel: 'Tên trên chứng nhận',
    certificateNamePlaceholder: 'Nguyễn Văn A',
    certificateNameHint: 'Tên này sẽ hiển thị công khai trên chứng nhận, và không thể sửa sau khi cấp.',
    certificateView: 'Xem chứng nhận',
    /**
     * Sharing. The link points at the public IQ landing page, never at a result URL - a
     * result URL is the credential for that result, so pasting one into a group chat would
     * hand it to everyone there.
     */
    certificateShare: 'Chia sẻ kết quả',
    shareCopied: 'Đã sao chép liên kết',
    shareCopyManually: 'Sao chép liên kết này:',
    certificateVerified: 'Chứng nhận đã được xác thực',
    certificateNotFound: 'Không tìm thấy chứng nhận này.',
    certificateIssued: 'Cấp ngày',
    verifyThis: 'Kiểm chứng chứng nhận này',
    invalidName: 'Tên không hợp lệ.',

    scoreLabel: 'Điểm',
    ofPopulation: 'phân vị',
    rateLimited: 'Bạn thao tác hơi nhanh. Vui lòng thử lại sau một lát.',
    genericError: 'Có lỗi xảy ra. Vui lòng thử lại.',

    /**
     * The paywall. Only rendered when IQ_RESULT_PRICE is set above the PayOS minimum; with
     * no price the whole result is free and none of this appears.
     *
     * The mechanical checkout strings - QR, bank fields, countdown - come from
     * `lib/test-kit/payment-copy.ts`, shared with MBTI.
     */
    paywallTitle: 'Bài làm của bạn đã được tính điểm',
    /** `{price}` is filled from the configured amount, formatted in đồng. */
    paywallLead:
      'Kết quả đầy đủ gồm chỉ số IQ, phân vị, xếp loại, và một chứng nhận công khai mang tên bạn để chia sẻ hoặc để người khác kiểm chứng - {price}.',
    emailLabel: 'Email nhận kết quả',
    emailPlaceholder: 'ban@example.com',
    emailHint: 'Chúng tôi chỉ dùng email này để gửi kết quả cho bạn.',
    /** `{email}` is the address the buyer just entered. */
    payDeliveryNote:
      'Kết quả sẽ hiện ngay trên trang này sau khi thanh toán, đồng thời được gửi tới {email}. Vui lòng không rời khỏi trang trong lúc chờ.',
    invalidEmail: 'Email không hợp lệ.',
    /** Shown on a locked result so a recipient still has a way into the test. */
    lockedRecruitLead: 'Bạn chưa làm bài test này?',
    lockedRecruitCta: 'Làm thử ngay',

    /**
     * Shown instead of the paywall when the attempt does not measure anything.
     *
     * Says why, plainly. The rule is a validity guarantee, not a discount, and it only
     * reads that way if the reason is on the page - "we don't charge for a number we can't
     * stand behind" is defensible; a silently free result looks like arbitrary pricing.
     */
    waivedTitle: 'Lần này miễn phí',
    waivedBody:
      'Bạn đi qua bài test quá nhanh, hoặc bỏ qua phần lớn câu hỏi, nên số câu đúng chỉ ngang mức đoán ngẫu nhiên. Điểm bên dưới vì vậy không đo được gì cả - và chúng tôi không thu phí cho một con số như vậy. Nếu bạn muốn một kết quả thật, hãy làm lại và làm nghiêm túc.',
    waivedNoCertificate:
      'Lần làm này không kèm chứng nhận: chứng nhận là trang công khai để người khác kiểm chứng, nên nó chỉ được cấp cho một kết quả thật.',
  },
  en: {
    brand: 'IQ',
    landingTitle: 'Online IQ test: a visual reasoning test scored the moment you finish',
    landingLead:
      '26 visual questions, 24 minutes. No signup and no account. The questions are generated fresh for every attempt.',
    startTest: 'Start the test',
    howItWorks: 'How the test works',
    howItWorksBody:
      'Each question is a geometric figure with one cell missing. You pick the right cell from six options. There are {count} questions, rising in difficulty, in {minutes} minutes. The questions are generated per attempt, so there is no shared answer key to look up.',
    methodLink: 'How scoring works',
    privacyLink: 'Privacy',
    /** See the Vietnamese entry for why this is a question rather than a label. */
    methodTeaseTitle: 'Is this score real?',
    methodTeaseBody:
      'Most online IQ sites skew scores upward, because a flattered visitor shares more. We do not - and here is the full band table, exactly how it is calculated, and what this test genuinely cannot tell you.',
    methodTeaseCta: 'See how scoring works',

    questionProgress: 'Question {current} of {total}',
    timeLeft: 'Time left',
    skip: 'Skip',
    back: 'Previous',
    submitting: 'Scoring...',
    timeUp: 'Time is up. Your answers are being scored.',
    confirmLeave: 'You are in the middle of the test. Leaving will lose your result.',

    yourScore: 'Your IQ score',
    percentileLabel: 'Higher than {percentile}% of the population',
    rawLabel: '{raw} of {total} correct',
    bandLabel: 'Band',
    keepLink: 'Keep this link. It is the only way back to your result, and it expires after {days} days.',
    retake: 'Take the test again',
    reviewAnswers: 'Review each question',
    correct: 'Correct',
    incorrect: 'Wrong',
    skipped: 'Skipped',
    yourAnswer: 'You chose',
    theAnswer: 'Answer',

    certificateTitle: 'Result certificate',
    certificateLead:
      'A public certificate with your name, score and percentile - shareable, and verifiable by anyone.',
    certificateNameLabel: 'Name on the certificate',
    certificateNamePlaceholder: 'Alex Nguyen',
    certificateNameHint: 'Shown publicly on the certificate, and cannot be changed once issued.',
    certificateView: 'View certificate',
    /** See the Vietnamese entry for why the shared link is never a result URL. */
    certificateShare: 'Share your result',
    shareCopied: 'Link copied',
    shareCopyManually: 'Copy this link:',
    certificateVerified: 'This certificate is verified',
    certificateNotFound: 'No such certificate.',
    certificateIssued: 'Issued',
    verifyThis: 'Verify this certificate',
    invalidName: 'That name is not valid.',

    scoreLabel: 'Score',
    ofPopulation: 'percentile',
    rateLimited: 'That was a little fast. Please try again in a moment.',
    genericError: 'Something went wrong. Please try again.',

    /** See the Vietnamese entry. Shared checkout strings live in test-kit/payment-copy. */
    paywallTitle: 'Your test has been scored',
    /** `{price}` is filled from the configured amount, formatted in đồng. */
    paywallLead:
      'The full result gives you your IQ score, your percentile, your band, and a public certificate in your name to share or have verified - {price}.',
    emailLabel: 'Email for your result',
    emailPlaceholder: 'you@example.com',
    emailHint: 'Used only to send you the result.',
    /** `{email}` is the address the buyer just entered. */
    payDeliveryNote:
      'Your result appears on this page as soon as the payment lands, and a copy goes to {email}. Please stay on this page while you pay.',
    invalidEmail: 'That email address is not valid.',
    /** Shown on a locked result so a recipient still has a way into the test. */
    lockedRecruitLead: 'Not taken the test yet?',
    lockedRecruitCta: 'Take it now',

    /** See the Vietnamese entry for why the reason is stated rather than left implicit. */
    waivedTitle: 'This one is free',
    waivedBody:
      'You went through the test faster than it can be read, or skipped most of it, so your number of correct answers is around what guessing produces. That means the score below does not measure anything - and we do not charge for a number like that. If you want a real result, take it again and take it seriously.',
    waivedNoCertificate:
      'No certificate with this one: a certificate is a public page for other people to verify, so it is only issued for a real result.',
  },
} as const

export const BAND_LABELS: Record<Locale, Record<string, string>> = {
  vi: {
    exceptional: 'Rất đặc biệt',
    gifted: 'Xuất sắc',
    superior: 'Vượt trội',
    high: 'Trên mức cao',
    above: 'Trên trung bình',
    average: 'Trung bình',
    below: 'Dưới trung bình',
    low: 'Thấp',
    floor: 'Rất thấp',
  },
  en: {
    exceptional: 'Exceptional',
    gifted: 'Gifted',
    superior: 'Superior',
    high: 'High',
    above: 'Above average',
    average: 'Average',
    below: 'Below average',
    low: 'Low',
    floor: 'Well below average',
  },
}

/**
 * The scoring-method page.
 *
 * This is P4 made visible. The industry's conversion lever is score inflation - sites skew
 * the curve because a flattered visitor shares and pays. This page is the commitment not
 * to, written where a visitor can check it: what the number is, what it is anchored to, and
 * plainly that it is provisional.
 *
 * It is also the honest answer to "is this a real IQ test". Not fully: it is a screening
 * instrument on a conventional scale, and saying so costs nothing except the ability to
 * pretend otherwise.
 */
export const IQ_METHOD = {
  vi: {
    title: 'Cách tính điểm',
    intro:
      'Trang này giải thích chính xác con số bạn nhận được nghĩa là gì, và không có gì hơn thế. Nếu có phần nào đọc như quảng cáo, đó là lỗi của chúng tôi.',
    sections: [
      {
        heading: 'Điểm được tính thế nào',
        body: 'Chúng tôi đếm số câu bạn trả lời đúng, rồi tra bảng để ra một dải điểm trên thang quy ước (trung bình 100, độ lệch chuẩn 15). Đây là một phép ánh xạ từ điểm thô sang dải điểm - KHÔNG phải một ước lượng năng lực theo mô hình IRT.',
      },
      {
        heading: 'Vì sao không phải ước lượng năng lực',
        body: 'Một bài test IQ đúng nghĩa cần hiệu chuẩn từng câu trên một mẫu dân số thực. Chúng tôi chưa có mẫu đó. Nếu đưa ra một con số lẻ tới hàng đơn vị, đó sẽ là sự chính xác giả tạo. 26 câu không thể phân biệt 128 với 131, nên bảng điểm được chia thô đúng theo độ phân giải thật của bài test.',
      },
      {
        heading: 'Bảng điểm',
        body: 'Điểm thô càng cao thì dải điểm càng cao. Bảng đầy đủ được liệt kê ngay dưới đây, không có phần nào bị ẩn.',
      },
      {
        heading: 'Neo vào đâu',
        body: 'Độ khó của 26 câu được neo theo các chuẩn đã công bố cho ma trận kiểu Raven, không phải dữ liệu của chúng tôi. Đây là điểm yếu lớn nhất của bài test và chúng tôi ghi rõ ở đây: thang điểm là TẠM THỜI, và sẽ được hiệu chuẩn lại khi có đủ người làm thật.',
      },
      {
        heading: 'Đây không phải đánh giá lâm sàng',
        body: 'Đây là bài test sàng lọc để tự tìm hiểu. Nó không dùng để chẩn đoán, không dùng để tuyển dụng, và không thay thế đánh giá của chuyên gia tâm lý.',
      },
      {
        heading: 'Chúng tôi không làm đẹp điểm',
        body: 'Nhiều trang test IQ cố tình đẩy điểm lên cao, vì người được khen thì chia sẻ và trả tiền nhiều hơn. Chúng tôi không làm vậy. Điểm của bạn có thể thấp hơn mong đợi, và đó là mục đích của việc đo lường.',
      },
      {
        /*
         * The waiver, on the page that exists to be checkable. Stated here as well as on
         * the result itself so it is a published rule rather than a surprise: a policy
         * someone can read before they start is a promise, the same one discovered
         * afterwards is a trick.
         *
         * `requiresWaiver` is what keeps that true in both directions: with
         * `EFFORT_WAIVER=false` the rule does not exist, so the page must not claim it.
         */
        requiresWaiver: true,
        heading: 'Nếu bạn làm quá nhanh, chúng tôi không thu phí',
        body: 'Nếu bạn bấm qua bài test trong vài phút hoặc bỏ qua phần lớn câu hỏi, số câu đúng sẽ chỉ ngang mức đoán ngẫu nhiên - và một con số như vậy không đo được gì. Trong trường hợp đó kết quả được mở miễn phí, có ghi rõ lý do, và không kèm chứng nhận. Chúng tôi chỉ thu phí cho một kết quả mà chúng tôi có thể đứng ra bảo đảm.',
      },
    ],
  },
  en: {
    title: 'How scoring works',
    intro:
      'This page explains exactly what your number means and nothing beyond that. If any of it reads like marketing, that is a mistake on our part.',
    sections: [
      {
        heading: 'How the score is calculated',
        body: 'We count how many questions you answered correctly, then look that total up in a table to get a band on the conventional scale (mean 100, standard deviation 15). It is a raw-score-to-band mapping - NOT an IRT ability estimate.',
      },
      {
        heading: 'Why not an ability estimate',
        body: 'A real IQ instrument calibrates each item against a population sample. We do not have one. Producing a number precise to the unit would be false precision with a decimal point on it. Twenty-six questions cannot tell a 128 from a 131, so the table is deliberately coarse - about the resolution this test actually has.',
      },
      {
        heading: 'The band table',
        body: 'A higher raw score maps to a higher band. The complete table is printed below; nothing is hidden.',
      },
      {
        heading: 'What it is anchored to',
        body: 'The difficulty of the 26 questions is anchored to published norms for Raven-style matrices, not to our own data. This is the weakest part of the test and it is stated here rather than buried: the scale is PROVISIONAL and will be re-normed once enough real people have taken it.',
      },
      {
        heading: 'This is not a clinical assessment',
        body: 'It is a screening test for your own curiosity. It is not diagnostic, not for hiring, and not a substitute for assessment by a qualified psychologist.',
      },
      {
        heading: 'We do not inflate scores',
        body: 'Many online IQ sites deliberately skew results upward, because a flattered visitor shares and pays more readily. We do not. Your score may be lower than you hoped, and that is the point of measuring it.',
      },
      {
        /* See the Vietnamese entry: published here so the rule is a promise, not a surprise. */
        requiresWaiver: true,
        heading: 'If you rush it, we do not charge',
        body: 'If you click through the test in a couple of minutes, or skip most of it, your number of correct answers lands around what guessing produces - and a number like that measures nothing. When that happens the result is opened for free, the reason is stated on it, and no certificate is issued. We only charge for a result we can stand behind.',
      },
    ],
  },
} as const

/** The band table, rendered on `/iq/method` so the mapping is public rather than implied. */
export function bandTableRows(locale: Locale) {
  return BANDS.map(band => ({
    raw: band.minRaw,
    score: band.score,
    percentile: band.percentile,
    label: BAND_LABELS[locale][band.key] ?? band.key,
  }))
}

export function iqUi(locale: Locale) {
  return IQ_UI[locale]
}

/** `fill('Câu {current} / {total}', {current: 3, total: 26})`. */
export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.replaceAll(`{${key}}`, String(value)),
    template
  )
}

/**
 * Long-form landing content.
 *
 * ## Why this exists and why it is not filler
 *
 * `/iq` and `/iq/method` are the only two IQ pages a stranger can find without a link, and
 * a landing page that is a headline plus a button ranks for nothing. But the reason to add
 * words is not word count - Google's own guidance is explicit that thin, generated,
 * unhelpful text is what gets penalised, and "26 questions, 24 minutes" repeated five ways
 * is exactly that.
 *
 * So the content here is the material only this test can supply:
 *
 *  - **The actual rule families.** Every competitor shows sample questions; none explain
 *    the six transformations their items are built from, because most bought a fixed image
 *    bank and do not know. This is genuinely differentiated, genuinely useful to someone
 *    deciding whether to bother, and it happens to target real long-tail queries
 *    ("ma trận IQ", "quy luật xoay hình", "iq matrix rules").
 *  - **What the test cannot do.** The honest limits, stated on the page people land on
 *    rather than buried. Same claim as `/iq/method`, so the two cannot drift.
 *  - **How to actually sit it.** Practical, not motivational.
 *  - **The FAQ, rendered visibly.** It was previously only in JSON-LD, which means a
 *    crawler saw answers a human never could.
 */
export const IQ_LANDING_SECTIONS = {
  vi: {
    aboutHeading: 'Bài test này đo cái gì',
    aboutBody:
      'Đây là bài test suy luận bằng hình ảnh, thuộc họ ma trận tiến triển (progressive matrices). Nó không kiểm tra kiến thức, không cần từ vựng, không cần tính toán - nên không phụ thuộc vào việc bạn học trường nào hay đọc bao nhiêu sách. Cái nó đo là khả năng nhìn ra một quy luật chưa từng thấy trước đó, rồi áp dụng quy luật ấy cho một trường hợp mới. Đó là lý do dạng bài này được dùng rộng rãi trong nghiên cứu về trí thông minh linh hoạt (fluid intelligence).',

    rulesHeading: 'Các quy luật bạn sẽ gặp',
    /** See the English entry: the layout claim and the direction promise are both load-bearing. */
    rulesLead:
      'Phần lớn các câu là ma trận 3x3 thiếu một ô. Một số câu là dãy ngắn hơn để bạn tiếp tục, và ô còn thiếu luôn được xác định bởi ít nhất một trong các quy luật dưới đây. Một dãy luôn tiếp tục theo cùng một chiều - không bao giờ quay ngược lại. Biết trước những điều này không giúp bạn "gian lận" - việc khó vẫn là nhận ra quy luật nào đang hoạt động, và ở những câu sau là hai hoặc ba quy luật cùng lúc.',
    /**
     * One entry per family in `lib/iq/items/v2/rules.ts`, and that correspondence is the
     * point rather than a nicety: this list is a published promise that the missing cell is
     * always determined by something on it. An entry with no family behind it is a rule the
     * test does not contain; a family with no entry is a rule the taker was never told about.
     * Either way the promise breaks, so the two are meant to be edited together.
     */
    rules: [
      {
        name: 'Chu kỳ tô đậm',
        body: 'Một hình đi qua các trạng thái rỗng, nửa đậm, đậm - theo hàng hoặc theo cột. Ở những câu sau, một chiều khác thay đổi song song và ô thiếu được quyết định bởi cả hai.',
      },
      {
        name: 'Chu kỳ hình dạng',
        body: 'Hình đi qua một vòng các dạng và quay lại đầu. Việc khó là nhận ra vòng lặp đang ở đâu - nên quy luật này chỉ xuất hiện ở dạng ma trận, nơi hai trục cùng xác nhận cách đọc.',
      },
      {
        name: 'Số cạnh tăng dần',
        body: 'Tam giác, vuông, ngũ giác, lục giác, thất giác - số cạnh tăng theo một bước cố định. Vì có thứ tự rõ ràng, đây là quy luật hình dạng duy nhất dùng được cho các câu dạng dãy.',
      },
      {
        name: 'Phép xoay',
        body: 'Một hình xoay theo một góc cố định mỗi ô. Phương án sai thường lệch đúng một bước - nên đoán bừa hầu như luôn trượt.',
      },
      {
        name: 'Thay đổi kích thước',
        body: 'Hình lớn dần hoặc nhỏ dần theo từng bước đều. Dễ nhìn ra, nhưng dễ bị nhiễu khi có thêm một chiều khác thay đổi song song.',
      },
      {
        name: 'Di chuyển vị trí',
        body: 'Một phần tử đi vòng quanh các vị trí trong ô theo một bước cố định. Bạn phải theo dõi nó đi đâu, không phải nó trông thế nào.',
      },
      {
        name: 'Đếm phần tử',
        body: 'Số vạch hoặc số phần tử tăng theo một bước cố định. Đơn giản về thị giác nhưng bước nhảy không được nói ra - bạn phải suy ra nó từ những ô đã cho.',
      },
      {
        name: 'Logic tập hợp (AND / OR / XOR)',
        body: 'Khó nhất, và chỉ xuất hiện ở nửa sau. Cột thứ ba là kết quả của một phép logic giữa hai cột đầu, tính trên từng ô của lưới điểm. Bạn phải suy ra phép toán từ hai hàng đầy đủ, rồi áp dụng cho hàng thứ ba.',
      },
    ],

    tipsHeading: 'Làm bài thế nào cho đúng sức',
    tips: [
      'Đừng dừng quá lâu ở một câu. Độ khó tăng dần, nên một câu ở giữa mà bạn bỏ qua có thể rẻ hơn ba câu cuối bạn không kịp xem.',
      'Bỏ qua được và quay lại được. Câu bỏ trống tính là sai, nhưng không bị trừ thêm - nên đoán vào phút cuối luôn tốt hơn để trống.',
      'Xác định chiều nào đang thay đổi trước, rồi mới tìm quy luật của chiều đó. Ở các câu sau thường có hai chiều thay đổi cùng lúc.',
      'Đồng hồ chạy ở phía máy chủ. Tải lại trang hay đóng tab không làm đồng hồ dừng, nên hãy làm liền một lần.',
      'Không cần giấy bút, không cần máy tính. Nếu bạn thấy mình đang tính toán, gần như chắc chắn đó không phải quy luật.',
    ],

    limitsHeading: 'Những gì bài test này KHÔNG làm được',
    limitsBody:
      'Đây là bài test sàng lọc để bạn tự tìm hiểu, không phải đánh giá lâm sàng. Nó không dùng để chẩn đoán, không dùng để tuyển dụng, và không thay thế đánh giá của chuyên gia tâm lý. Thang điểm hiện tại được neo theo các chuẩn đã công bố cho ma trận kiểu Raven, không phải dữ liệu của riêng chúng tôi - nghĩa là nó vẫn TẠM THỜI. 26 câu cũng không thể phân biệt 128 với 131, nên đừng đọc con số kỹ hơn mức nó chịu được.',

    faqHeading: 'Câu hỏi thường gặp',
  },
  en: {
    aboutHeading: 'What this test measures',
    aboutBody:
      'This is a visual reasoning test in the progressive matrices family. It tests no knowledge, needs no vocabulary and involves no arithmetic - so it does not depend on where you went to school or how much you have read. What it measures is your ability to spot a rule you have never seen before and then apply it to a new case. That is why this format is widely used in research on fluid intelligence.',

    rulesHeading: 'The rules you will meet',
    /**
     * Two claims here are load-bearing and were both false for a while, so they are worth
     * flagging for whoever edits this next.
     *
     * The layout sentence: questions are NOT all 3x3. Nine of the 26 are three-cell
     * sequences and one is a 2x2, and a sequence is the harder container - three cells
     * confirm a rule once where nine confirm it twice.
     *
     * The direction sentence is not documentation. Three cells reading outline, half, filled
     * are consistent with the cycle continuing AND with a palindrome turning back, so without
     * a published promise that a series never reverses, two of the six options are defensible
     * and one of them is marked wrong. Saying it here is what makes the sequence items fair.
     */
    rulesLead:
      'Most questions are a 3x3 matrix with one cell missing. Some are a shorter sequence you continue, and the missing cell is always determined by at least one of the rules below. A series always carries on in the same direction - it is never mirrored back on itself. Knowing all of this is not cheating: the hard part is still working out which rule is running, and in later questions it is two or three at once.',
    /** See the Vietnamese entry: one entry per family, and they are edited together. */
    rules: [
      {
        name: 'Shading cycle',
        body: 'A shape moves through outline, half-shaded and filled, across a row or down a column. In later questions a second dimension changes alongside it, and the missing cell is decided by both.',
      },
      {
        name: 'Shape cycle',
        body: 'The shape steps through a ring of forms and returns to the start. The hard part is spotting where in the ring you are - which is why this one only appears in matrix questions, where two axes confirm the reading.',
      },
      {
        name: 'Side count',
        body: 'Triangle, square, pentagon, hexagon, heptagon - the number of sides rises by a fixed step. Because it has a genuine order, this is the only shape rule that can be used in the shorter sequence questions.',
      },
      {
        name: 'Rotation',
        body: 'A shape turns by a fixed angle each cell. Wrong options are usually off by exactly one step, which is why guessing almost never lands.',
      },
      {
        name: 'Size',
        body: 'A shape grows or shrinks by even steps. Easy to see on its own, easy to lose track of when a second dimension moves alongside it.',
      },
      {
        name: 'Movement',
        body: 'An element travels around the positions inside the cell by a fixed step. You have to follow where it goes, not what it looks like.',
      },
      {
        name: 'Counting',
        body: 'The number of strokes or elements rises by a fixed step. Visually simple, but the step is never stated - you infer it from the cells you are given.',
      },
      {
        name: 'Set logic (AND / OR / XOR)',
        body: 'The hardest, and it only appears in the back half. The third column is the result of a logical operation between the first two, worked out slot by slot on the dot lattice. You have to infer which operation from two complete rows, then apply it to the third.',
      },
    ],

    tipsHeading: 'How to actually sit it',
    tips: [
      'Do not park on one question. Difficulty rises, so a skipped question in the middle can cost less than three at the end you never reach.',
      'You can skip and you can go back. A blank counts as wrong but costs nothing extra, so a guess at the end always beats an empty answer.',
      'Work out which dimension is changing before hunting for the rule. Later questions usually have two changing at once.',
      'The clock runs on the server. Reloading or closing the tab does not pause it, so sit the test in one go.',
      'No paper, no calculator. If you find yourself doing arithmetic, that is almost certainly not the rule.',
    ],

    limitsHeading: 'What this test genuinely cannot do',
    limitsBody:
      'This is a screening test for your own curiosity, not a clinical assessment. It is not diagnostic, not for hiring, and not a substitute for assessment by a qualified psychologist. The scale is currently anchored to published norms for Raven-style matrices rather than to our own data, which means it is still PROVISIONAL. Twenty-six questions also cannot tell a 128 from a 131, so do not read the number more precisely than it can bear.',

    faqHeading: 'Frequently asked questions',
  },
} as const
