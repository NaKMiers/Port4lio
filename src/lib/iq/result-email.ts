import IqResultEmail from '@/components/email/IqResultEmail'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n'
import { BAND_LABELS, iqUi } from '@/lib/iq/content'
import { sendMail } from '@/lib/mailer'
import { resolveSiteOrigin } from '@/lib/seo'
import { IqAttemptModel } from '@/models/IqAttempt'
import type { IqPaymentDocument } from '@/models/IqPayment'

/**
 * Renders and sends the paid IQ result email.
 *
 * Injected into `fulfilIqPayment` as its `deliver` callback rather than imported there, so
 * the fulfilment logic can be unit-tested without a mail server and without dragging
 * nodemailer and React into that import graph.
 *
 * Throws on any failure. The caller catches it and reports `delivery-failed`; throwing here
 * rather than swallowing is what makes a silent non-delivery impossible.
 */
export async function deliverIqResultEmail(payment: IqPaymentDocument): Promise<void> {
  const attempt = await IqAttemptModel.findById(payment.attemptToken).lean()

  if (!attempt) {
    throw new Error(`IQ attempt ${payment.attemptToken} not found`)
  }
  if (attempt.score === null || attempt.percentile === null) {
    throw new Error(`IQ attempt ${payment.attemptToken} has no score to send`)
  }
  if (!attempt.certificateId) {
    // Fulfilment mints the id before delivery, so reaching here means the two got out of
    // order. Better to fail loudly than to mail a certificate link that 404s.
    throw new Error(`IQ attempt ${payment.attemptToken} has no certificate id`)
  }

  // The locale the buyer was reading when they paid. Falls back rather than throwing: a
  // result in the wrong language still beats no email at all.
  const locale: Locale = isLocale(payment.locale)
    ? payment.locale
    : isLocale(attempt.locale)
      ? attempt.locale
      : DEFAULT_LOCALE

  const origin = resolveSiteOrigin().replace(/\/$/, '')
  const copy = iqUi(locale)

  const { render } = await import('@react-email/render')

  const element = IqResultEmail({
    locale,
    score: attempt.score,
    percentile: attempt.percentile,
    raw: attempt.raw ?? 0,
    total: attempt.answers?.length ?? 0,
    bandLabel: BAND_LABELS[locale][attempt.band ?? ''] ?? attempt.band ?? '',
    certificateName: payment.certificateName,
    resultUrl: `${origin}/${locale}/iq/result/${payment.attemptToken}`,
    certificateUrl: `${origin}/${locale}/iq/certificate/${attempt.certificateId}`,
  })

  const html = await render(element)
  // A multipart message reads better in text-only clients and scores lower with spam
  // filters than HTML alone.
  const text = await render(element, { plainText: true })

  await sendMail({
    to: payment.email,
    subject: `${copy.yourScore}: ${attempt.score}`,
    html,
    text,
  })
}
