import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import Chevron from '@/components/mbti/Chevron'
import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import { isLocale, LOCALES } from '@/lib/i18n'
import { UI } from '@/lib/mbti/content'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * Privacy notice for the MBTI feature.
 *
 * Scoped to `/[lang]/mbti` on purpose: the portfolio in `(me)` collects nothing from
 * visitors, so a site-wide policy would be claiming to govern data that does not exist.
 *
 * The retention figure is imported from the model rather than typed here, so the promise
 * and the TTL index cannot drift apart. If someone changes `ATTEMPT_TTL_DAYS`, this page
 * changes with it.
 */
export const dynamic = 'force-static'

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
  return { title: UI[lang].privacy }
}

const COPY = {
  vi: {
    title: 'Chính sách bảo mật',
    intro:
      'Trang MBTI này thu thập rất ít dữ liệu. Dưới đây là toàn bộ những gì được lưu, vì sao, và lưu trong bao lâu.',
    sections: [
      {
        heading: 'Những gì được lưu',
        body: 'Khi bạn hoàn thành bài trắc nghiệm, chúng tôi lưu các câu trả lời của bạn, nhóm tính cách được tính ra, và ngôn ngữ bạn đang dùng. Không có tên, không có email, không có tài khoản. Kết quả được gắn với một đường dẫn ngẫu nhiên mà chỉ người giữ đường dẫn đó mới mở được.',
      },
      {
        heading: 'Những gì KHÔNG được lưu',
        body: 'Chúng tôi không dùng cookie theo dõi, không gắn mã quảng cáo, và không chia sẻ dữ liệu với bên thứ ba. Nếu bạn chỉ làm bài trắc nghiệm miễn phí, chúng tôi không có bất kỳ thông tin liên hệ nào của bạn.',
      },
      {
        heading: 'Nếu bạn mua kết quả đầy đủ',
        body: 'Khi bạn thanh toán, chúng tôi lưu địa chỉ email bạn nhập để gửi kết quả, cùng với số tiền và mã giao dịch. Email này chỉ dùng để gửi kết quả cho bạn - không có bản tin, không quảng cáo, không bán cho bên thứ ba. Việc thanh toán do PayOS xử lý; chúng tôi không bao giờ nhìn thấy hay lưu thông tin thẻ hoặc tài khoản ngân hàng của bạn.',
      },
      {
        heading: 'Lưu hồ sơ thanh toán trong bao lâu',
        body: 'Giao dịch chưa hoàn tất sẽ tự xóa sau 7 ngày. Giao dịch đã thanh toán được giữ lại như một hồ sơ tài chính, để chúng tôi có thể hỗ trợ bạn nếu sau này có vấn đề về thanh toán.',
      },
      {
        heading: 'Lưu trong bao lâu',
        body: `Kết quả tự động bị xóa sau ${ATTEMPT_TTL_DAYS} ngày. Sau thời gian đó, đường dẫn kết quả của bạn sẽ không còn mở được nữa. Đây là xóa thật ở tầng cơ sở dữ liệu, không phải ẩn đi.`,
      },
      {
        heading: 'Địa chỉ IP',
        body: 'Địa chỉ IP của bạn được dùng tạm thời để giới hạn số lần gửi bài, nhằm tránh việc bị lạm dụng tự động. Bản ghi này tự hết hạn sau vài phút và không được gắn với kết quả của bạn.',
      },
      {
        heading: 'Xóa dữ liệu',
        body: 'Bạn không cần yêu cầu xóa: chỉ cần không dùng đường dẫn kết quả nữa và nó sẽ tự biến mất theo thời hạn ở trên. Nếu bạn muốn xóa sớm hơn, hãy liên hệ qua trang chủ.',
      },
    ],
  },
  en: {
    title: 'Privacy',
    intro:
      'This MBTI feature collects very little. Here is everything that is stored, why, and for how long.',
    sections: [
      {
        heading: 'What is stored',
        body: 'When you finish the test we store your answers, the type they produced, and the language you were using. No name, no email, no account. The result is addressed by a random link that only whoever holds it can open.',
      },
      {
        heading: 'What is NOT stored',
        body: 'No tracking cookies, no advertising pixels, and no sharing with third parties. If you only take the free test, we hold no way of contacting you at all.',
      },
      {
        heading: 'If you buy the full result',
        body: 'When you pay, we store the email address you enter so we can send you the result, along with the amount and a transaction reference. That address is used only to send your result - no newsletter, no marketing, never sold. Payment is handled by PayOS; we never see or store your card or bank details.',
      },
      {
        heading: 'How long payment records are kept',
        body: 'An unfinished checkout is deleted automatically after 7 days. A completed payment is kept as a financial record, so we can help you if a question about it comes up later.',
      },
      {
        heading: 'How long it is kept',
        body: `Results are deleted automatically after ${ATTEMPT_TTL_DAYS} days. After that your result link stops working. This is a real database deletion, not hiding.`,
      },
      {
        heading: 'IP address',
        body: 'Your IP address is used briefly to rate-limit submissions and prevent automated abuse. That record expires within minutes and is never linked to your result.',
      },
      {
        heading: 'Deleting your data',
        body: 'You do not need to request deletion: stop using the result link and it expires on the schedule above. If you want it removed sooner, get in touch via the home page.',
      },
    ],
  },
} as const

export default async function MbtiPrivacyPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const copy = COPY[lang]

  return (
    <main>
      <SectionFrame
        aria-labelledby='privacy-heading'
        disableReveal
        className='pb-section-sm pt-10 md:pt-14'
        innerClassName='max-w-2xl'
      >
        <Link
          href={`/${lang}/mbti`}
          className='inline-flex items-center gap-2 text-sm font-semibold text-pp-muted no-underline transition hover:text-pp-text'
        >
          <Chevron direction='left' />
          {UI[lang].backToStart}
        </Link>

        <h1
          id='privacy-heading'
          className='mt-6 font-display text-[clamp(1.875rem,4.5vw,2.75rem)] font-semibold leading-tight tracking-tight text-pp-text'
        >
          {copy.title}
        </h1>
        <p className='mt-4 text-base leading-relaxed text-pp-muted md:text-lg'>{copy.intro}</p>

        <div className='mt-10 space-y-3'>
          {copy.sections.map(section => (
            <EditorialPanel key={section.heading} variant='strong' className='p-5 md:p-6'>
              <h2 className='font-display text-sm font-semibold uppercase tracking-[0.18em] text-pp-text'>
                {section.heading}
              </h2>
              <p className='mt-2.5 text-sm leading-relaxed text-pp-muted'>{section.body}</p>
            </EditorialPanel>
          ))}
        </div>
      </SectionFrame>
    </main>
  )
}
