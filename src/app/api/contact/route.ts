import { NextResponse } from 'next/server'

import { renderContactEmail } from '@/lib/email-templates'
import { sendMail } from '@/lib/mailer'
import { getRequiredEnv } from '@/lib/required-env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function POST(request: Request) {
  const { email, firstname, lastname, subject, message } = (await request.json()) ?? {}

  if (
    !isNonEmptyString(email) ||
    !isNonEmptyString(firstname) ||
    !isNonEmptyString(lastname) ||
    !isNonEmptyString(subject) ||
    !isNonEmptyString(message)
  ) {
    return NextResponse.json({ error: 'Please complete all contact form fields.' }, { status: 400 })
  }

  const senderEmail = email.trim()

  try {
    // The renderer escapes every one of these - they are anonymous visitor input, and
    // they used to be interpolated into the email HTML raw.
    const rendered = renderContactEmail({
      email: senderEmail,
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      subject: subject.trim(),
      message: message.trim(),
    })

    await sendMail({
      to: getRequiredEnv('MAIL_TO'),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      // Replying to the notification should reach the visitor, not the no-reply mailbox.
      replyTo: senderEmail,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Contact form submission failed', error)
    return NextResponse.json(
      {
        error: 'Unable to send your message right now. Please try again later or email me directly.',
      },
      { status: 500 }
    )
  }
}

export function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 })
}
