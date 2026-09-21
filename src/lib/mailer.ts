import nodeMailer from 'nodemailer'

import { getRequiredEnv } from '@/lib/required-env'

let cachedTransporter: ReturnType<typeof nodeMailer.createTransport> | null =
  null

function getTransporter() {
  if (cachedTransporter) return cachedTransporter

  cachedTransporter = nodeMailer.createTransport({
    service: 'gmail',
    secure: true,
    auth: {
      user: getRequiredEnv('MAIL'),
      pass: getRequiredEnv('MAIL_APP_PASSWORD'),
    },
  })

  return cachedTransporter
}

export type SendMailOptions = {
  to: string
  subject: string
  html: string
  /** Plaintext alternative. Sent alongside the HTML, not instead of it. */
  text?: string
  /**
   * Where a reply should go, when that is not the `from` address. The contact form uses
   * it so replying reaches the visitor instead of the unmonitored no-reply mailbox.
   */
  replyTo?: string
}

export async function sendMail({
  to,
  subject,
  html,
  text,
  replyTo,
}: SendMailOptions) {
  await getTransporter().sendMail({
    from: 'Portfolio <no-reply@anhkhoa.info>',
    to,
    subject,
    html,
    text,
    replyTo,
  })
}
