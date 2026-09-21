import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale, LOCALES } from '@/lib/i18n'
import { alternateIqLanguages } from '@/lib/iq/seo'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * The IQ privacy notice. Its own page rather than a link to MBTI's, because what is stored
 * genuinely differs: an IQ attempt holds a start time and a seed, and the certificate that
 * ships with a paid result holds a public display name that outlives the attempt.
 *
 * Written to be checkable rather than reassuring. If a section reads like it is defending a
 * practice rather than describing one, that is a bug. It also has to stay true when
 * `IQ_RESULT_PRICE` is unset - which is why the paid sections say "if you buy" rather than
 * asserting that everyone does.
 */
export const dynamic = 'force-static'

const COPY = {
  vi: {
    title: 'Chính sách bảo mật',
    intro:
      'Bài test IQ này thu thập rất ít dữ liệu. Dưới đây là toàn bộ những gì được lưu, vì sao, và trong bao lâu.',
    sections: [
      {
        heading: 'Những gì được lưu',
        body: `Khi bạn bắt đầu, chúng tôi lưu thời điểm bắt đầu và một số ngẫu nhiên dùng để sinh đề. Khi bạn nộp bài, chúng tôi lưu các lựa chọn của bạn và điểm. Đến đây chưa có gì nhận dạng được bạn: không tên, không email, không tài khoản. Kết quả được gắn với một đường dẫn ngẫu nhiên mà chỉ người giữ đường dẫn mới mở được.`,
      },
      {
        heading: 'Vì sao lưu thời điểm bắt đầu',
        body: 'Bài test có giới hạn 24 phút. Nếu đồng hồ chạy ở phía trình duyệt thì ai cũng có thể tạm dừng nó, và điểm của hai người sẽ không còn so sánh được. Vì vậy thời điểm bắt đầu được ghi ở phía máy chủ.',
      },
      {
        heading: 'Vì sao không lưu đề bài',
        body: 'Đề được sinh lại từ số ngẫu nhiên đó khi cần. Nhờ vậy trong cơ sở dữ liệu không hề có bộ đáp án nào để bị lộ.',
      },
      {
        heading: 'Nếu bạn thanh toán để mở kết quả',
        body: 'Lúc thanh toán bạn nhập email và tên muốn ghi trên chứng nhận. Hai thông tin này được lưu cùng giao dịch, và chỉ chuyển sang lượt làm bài của bạn khi thanh toán thành công - nếu bạn bỏ giữa đường, bản ghi giao dịch đó tự xóa sau 7 ngày. Email chỉ dùng để gửi kết quả cho bạn: không bản tin, không quảng cáo, không bán cho bên thứ ba. Giao dịch do PayOS xử lý; chúng tôi không bao giờ thấy hay lưu thông tin thẻ hay tài khoản ngân hàng của bạn. Bản ghi của một giao dịch ĐÃ thanh toán được giữ lại như chứng từ tài chính.',
      },
      {
        heading: 'Chứng nhận của bạn',
        body: 'Chứng nhận đi kèm kết quả đã thanh toán, và là một trang công khai có chủ đích. Nó lưu tên bạn nhập, điểm, phân vị và ngày cấp, cùng một mã công khai riêng - mã này KHÁC với đường dẫn kết quả của bạn, nên chia sẻ chứng nhận không hề mở quyền vào kết quả riêng tư. Vì chứng nhận cần kiểm chứng được, nó không bị xóa theo thời hạn bên dưới.',
      },
      {
        heading: 'Số liệu sử dụng',
        body: `Chúng tôi đếm một số việc để biết trang này có hoạt động hay không: kết quả được xem, được chia sẻ, và bạn dừng ở câu thứ mấy nếu bỏ dở. Mỗi tab có một mã tạm thời lưu trong sessionStorage, tự mất khi bạn đóng tab, chỉ để tránh đếm trùng một người. Số liệu này cũng tự xóa sau ${ATTEMPT_TTL_DAYS} ngày.`,
      },
      {
        heading: 'Lưu trong bao lâu',
        body: `Kết quả tự động bị xóa sau ${ATTEMPT_TTL_DAYS} ngày, kể cả kết quả đã thanh toán - trả tiền mở kết quả chứ không kéo dài thời gian lưu. Sau đó đường dẫn kết quả không còn mở được nữa. Đây là xóa thật ở tầng cơ sở dữ liệu, không phải ẩn đi. Email chúng tôi gửi cho bạn là bản lưu vĩnh viễn, và chứng nhận thì không hết hạn.`,
      },
      {
        heading: 'Địa chỉ IP',
        body: 'Địa chỉ IP được dùng tạm thời để giới hạn số lần gửi, tránh lạm dụng tự động. Bản ghi này tự hết hạn sau vài phút và không được gắn với kết quả của bạn.',
      },
    ],
  },
  en: {
    title: 'Privacy',
    intro:
      'This IQ test collects very little. Here is everything that is stored, why, and for how long.',
    sections: [
      {
        heading: 'What is stored',
        body: `When you start, we store the time you started and a random number used to generate your questions. When you submit, we store your choices and your score. Nothing to this point identifies you: no name, no email, no account. The result is addressed by a random link that only whoever holds it can open.`,
      },
      {
        heading: 'Why the start time is stored',
        body: 'The test has a 24-minute limit. A clock running in your browser is a clock anyone can pause, and two people’s scores would stop being comparable. So the start time is recorded on the server.',
      },
      {
        heading: 'Why the questions are not stored',
        body: 'They are regenerated from that random number when needed. As a result there is no answer key anywhere in the database to leak.',
      },
      {
        heading: 'If you pay to open your result',
        body: 'At checkout you enter an email address and the name you want on your certificate. Both are stored with the payment record and only copied onto your attempt once the payment settles - if you abandon checkout, that record deletes itself after 7 days. The email is used only to send you your result: no newsletter, no marketing, never sold. Payment is handled by PayOS; we never see or store your card or bank details. A record of a payment that DID settle is kept as a financial record.',
      },
      {
        heading: 'Your certificate',
        body: 'A certificate comes with a paid result, and it is a deliberately public page. It stores the name you enter, your score, percentile and issue date, plus its own public id - that id is DIFFERENT from your result link, so sharing a certificate never grants access to your private result. Because a certificate has to stay verifiable, it is not deleted on the schedule below.',
      },
      {
        heading: 'Usage counts',
        body: `We count a few things to know whether this works: results viewed, results shared, and how far you got if you left unfinished. Each browser tab gets a temporary id in sessionStorage that disappears when you close the tab, only so one person is not counted twice. These counts are deleted after ${ATTEMPT_TTL_DAYS} days too.`,
      },
      {
        heading: 'How long it is kept',
        body: `Results are deleted automatically after ${ATTEMPT_TTL_DAYS} days, paid ones included - paying opens your result, it does not extend how long we keep it. After that your result link stops working. This is a real database deletion, not hiding. The email we send you is your permanent copy, and your certificate does not expire.`,
      },
      {
        heading: 'IP address',
        body: 'Your IP is used briefly to rate-limit submissions and prevent automated abuse. That record expires within minutes and is never linked to your result.',
      },
    ],
  },
} as const

export function generateStaticParams() {
  return LOCALES.map(lang => ({ lang }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isLocale(lang)) return {}
  return {
    title: COPY[lang].title,
    // Reuses the intro paragraph the page already renders, so the snippet Google shows and
    // the first thing a visitor reads are the same sentence. Without this the snippet is
    // whatever fragment the crawler picks, which on a privacy notice tends to be a line
    // from the middle of the retention section.
    description: COPY[lang].intro,
    alternates: {
      canonical: `/${lang}/iq/privacy`,
      languages: alternateIqLanguages(locale => `/${locale}/iq/privacy`),
    },
  }
}

export default async function IqPrivacyPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()
  const copy = COPY[lang]

  return (
    <main>
      <SectionFrame
        aria-labelledby="iq-privacy-heading"
        disableReveal
        className="border-b border-pp-line pb-section-sm pt-10 md:pt-14"
        innerClassName="max-w-2xl"
      >
        <h1
          id="iq-privacy-heading"
          className="font-display text-[clamp(2.2rem,5vw,3.2rem)] font-semibold leading-tight tracking-tight text-pp-text"
        >
          {copy.title}
        </h1>
        <p className="mt-5 text-base leading-relaxed text-pp-muted md:text-lg">
          {copy.intro}
        </p>
      </SectionFrame>

      <SectionFrame
        className="py-section-sm"
        innerClassName="max-w-2xl"
      >
        <div className="space-y-8">
          {copy.sections.map(section => (
            <section key={section.heading}>
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text">
                {section.heading}
              </h2>
              <p className="mt-3 text-pp-muted">{section.body}</p>
            </section>
          ))}
        </div>
      </SectionFrame>
    </main>
  )
}
