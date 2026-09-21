import MbtiResultEmail from '@/components/email/MbtiResultEmail'
import { isLocale, DEFAULT_LOCALE, type Locale } from '@/lib/i18n'
import { sendMail } from '@/lib/mailer'
import { getTypeContent, UI } from '@/lib/mbti/content'
import { isMbtiType, type MbtiType } from '@/lib/mbti/types'
import { resolveSiteOrigin } from '@/lib/seo'
import { AttemptModel, type AttemptDocument } from '@/models/Attempt'
import type { PaymentDocument } from '@/models/Payment'

/**
 * Renders and sends the paid result email.
 *
 * Injected into `fulfilMbtiPayment` as its `deliver` callback rather than imported there,
 * so the fulfilment logic can be unit-tested without a mail server and without dragging
 * nodemailer and React into that import graph.
 *
 * Throws on any failure. The caller catches it and reports `delivery-failed`; throwing
 * here rather than swallowing is what makes a silent non-delivery impossible.
 */
export async function deliverResultEmail(
  payment: PaymentDocument
): Promise<void> {
  const attempt = (await AttemptModel.findById(
    payment.attemptToken
  ).lean()) as AttemptDocument | null

  if (!attempt) throw new Error(`Attempt ${payment.attemptToken} not found`)

  if (!isMbtiType(attempt.type))
    throw new Error(
      `Attempt ${payment.attemptToken} has an unknown type "${attempt.type}"`
    )

  // The locale the buyer was reading when they paid. Falls back rather than throwing: a
  // result in the wrong language still beats no email at all.
  const locale: Locale = isLocale(payment.locale)
    ? payment.locale
    : isLocale(attempt.locale)
      ? attempt.locale
      : DEFAULT_LOCALE

  const type = attempt.type as MbtiType
  const content = getTypeContent(locale, type)
  const resultUrl = `${resolveSiteOrigin().replace(/\/$/, '')}/${locale}/mbti/result/${payment.attemptToken}`

  const { render } = await import('@react-email/render')

  const element = MbtiResultEmail({
    locale,
    type,
    content,
    scores: attempt.scores,
    resultUrl,
  })

  const html = await render(element)
  // A multipart message reads better in text-only clients and scores lower with spam
  // filters than HTML alone.
  const text = await render(element, { plainText: true })

  await sendMail({
    to: payment.email,
    subject: `${UI[locale].resultTitle}: ${type} - ${content.nickname}`,
    html,
    text,
  })
}
