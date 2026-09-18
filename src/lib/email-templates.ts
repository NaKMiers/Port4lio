/**
 * The two transactional emails this site sends, sharing one shell.
 *
 * Constraints that shape the markup: nested tables and inline styles only (Outlook
 * renders neither flexbox nor a `<style>` block reliably), a hard 600px card because
 * older clients ignore `max-width` on divs, and web-safe font stacks because a
 * `@font-face` in an email is a wasted request. Every renderer returns a plaintext
 * sibling too - a multipart message reads better in text-only clients and scores lower
 * on spam filters than HTML alone.
 */

const CARD_WIDTH = 600

const COLOR = {
  page: '#f4f1ec',
  card: '#ffffff',
  line: '#e6e0d7',
  text: '#1f1b17',
  muted: '#6f665c',
  accent: '#b4552d',
  codeBg: '#f7f4ef',
} as const

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

/**
 * Escapes the five characters that can break out of HTML text or an attribute value.
 *
 * Load-bearing for the contact email, whose name / subject / message come straight from
 * an anonymous visitor: without this, a `<script>` or a tracking `<img>` in the message
 * body renders as live markup in the owner's inbox.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escaped, with newlines preserved as line breaks. */
function escapeHtmlMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />')
}

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://anhkhoa.info').replace(/\/+$/, '')
}

function siteLabel(): string {
  return siteOrigin().replace(/^https?:\/\//, '')
}

/**
 * The card: masthead, body, footer.
 *
 * `preheader` is the snippet the inbox list shows next to the subject. Hidden in the
 * body so it does not print twice - without one, clients scrape the first visible text
 * instead, which is rarely the useful sentence.
 */
function shell({
  preheader,
  eyebrow,
  heading,
  bodyHtml,
}: {
  preheader: string
  eyebrow: string
  heading: string
  bodyHtml: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0; padding:0; background-color:${COLOR.page}; -webkit-font-smoothing:antialiased;">
  <div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.page};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="${CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:${CARD_WIDTH}px; background-color:${COLOR.card}; border:1px solid ${COLOR.line}; border-radius:16px; overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 0 32px; font-family:${FONT};">
              <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:${COLOR.accent};">${escapeHtml(eyebrow)}</p>
              <h1 style="margin:10px 0 0 0; font-size:24px; line-height:1.25; font-weight:700; color:${COLOR.text};">${escapeHtml(heading)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px 32px; font-family:${FONT}; font-size:15px; line-height:1.6; color:${COLOR.text};">
${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 24px 32px; border-top:1px solid ${COLOR.line}; font-family:${FONT}; font-size:12px; line-height:1.6; color:${COLOR.muted};">
              Sent by <a href="${siteOrigin()}" style="color:${COLOR.accent}; text-decoration:none;">${escapeHtml(siteLabel())}</a>. This is an automated message &mdash; no need to reply to it directly.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** The owner login code for `/settings` and `/publish`. */
export function renderOtpEmail({
  code,
  ttlMinutes,
}: {
  code: string
  ttlMinutes: number
}): RenderedEmail {
  const minuteLabel = ttlMinutes === 1 ? 'minute' : 'minutes'

  const bodyHtml = `              <p style="margin:0 0 18px 0;">Use this code to unlock the portfolio editor. It works once, in the browser that asked for it.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:6px 0 18px 0;">
                    <div style="display:inline-block; padding:16px 28px; background-color:${COLOR.codeBg}; border:1px solid ${COLOR.line}; border-radius:12px; font-family:'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size:30px; font-weight:700; letter-spacing:0.24em; color:${COLOR.text};">${escapeHtml(code)}</div>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px 0; color:${COLOR.muted}; font-size:14px;">Expires in ${ttlMinutes} ${minuteLabel}. Requesting a new code replaces this one.</p>
              <p style="margin:0; color:${COLOR.muted}; font-size:14px;">If you did not ask for this, you can ignore the email &mdash; the code is useless without your browser session. Repeated unexpected codes mean someone found the editor URL, which is a good reason to rotate <strong>AUTH_SECRET</strong>.</p>`

  const text = [
    'Portfolio editor login code',
    '',
    `Code: ${code}`,
    `Expires in ${ttlMinutes} ${minuteLabel}. Requesting a new code replaces this one.`,
    '',
    'If you did not ask for this, ignore the email - the code is useless without your browser session.',
    '',
    siteLabel(),
  ].join('\n')

  return {
    subject: 'Your portfolio editor login code',
    html: shell({
      preheader: `Code ${code}, expires in ${ttlMinutes} ${minuteLabel}.`,
      eyebrow: 'Protected editor',
      heading: 'Your login code',
      bodyHtml,
    }),
    text,
  }
}

/**
 * The contact-form notification. Every field here is anonymous visitor input.
 *
 * `sourceSlug` and `heardAbout` are the attribution fields, and they are the reason this
 * signature takes optionals rather than growing two required strings: the portfolio form at
 * `/` sends neither, and a post page sends only the first. When both are absent the output
 * is byte-identical to what this rendered before they existed.
 *
 * They are escaped like everything else. `heardAbout` in particular is free text a stranger
 * typed - it is the one field with no charset constraint anywhere in the stack, so it is the
 * one most likely to carry markup, and it is being interpolated into HTML that lands in the
 * owner's own mail client.
 */
export function renderContactEmail({
  email,
  firstname,
  lastname,
  subject,
  message,
  sourceSlug,
  heardAbout,
}: {
  email: string
  firstname: string
  lastname: string
  subject: string
  message: string
  /** The blog post the reader came from, when there was one. */
  sourceSlug?: string | null
  /** What the visitor typed into "How did you hear about me?". */
  heardAbout?: string | null
}): RenderedEmail {
  const fullName = `${firstname} ${lastname}`.trim()

  const row = (label: string, valueHtml: string) =>
    `                <tr>
                  <td style="padding:0 0 4px 0; font-size:11px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${COLOR.muted};">${escapeHtml(label)}</td>
                </tr>
                <tr>
                  <td style="padding:0 0 16px 0; font-size:15px; color:${COLOR.text};">${valueHtml}</td>
                </tr>`

  // Only rendered when present, so the portfolio form's email does not grow two empty rows
  // that say nothing. Reading "Heard about: -" on every message trains the eye to skip the
  // line, which loses the one message where it is filled in.
  const attributionHtml = [
    sourceSlug ? row('Came from', `<code>/blog/${escapeHtml(sourceSlug)}</code>`) : '',
    heardAbout ? row('Heard about me via', escapeHtmlMultiline(heardAbout)) : '',
  ]
    .filter(Boolean)
    .join('\n')

  const bodyHtml = `              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:${FONT};">
${row('From', escapeHtml(fullName) || '<span style="color:' + COLOR.muted + ';">(no name given)</span>')}
${row('Reply to', `<a href="mailto:${escapeHtml(email)}" style="color:${COLOR.accent}; text-decoration:none;">${escapeHtml(email)}</a>`)}
${row('Subject', escapeHtml(subject))}${attributionHtml ? `\n${attributionHtml}` : ''}
              </table>
              <div style="padding:16px 18px; background-color:${COLOR.codeBg}; border:1px solid ${COLOR.line}; border-radius:12px; font-size:15px; line-height:1.65; color:${COLOR.text}; white-space:normal; word-break:break-word;">${escapeHtmlMultiline(message)}</div>
              <p style="margin:18px 0 0 0; color:${COLOR.muted}; font-size:13px;">Hit reply to answer ${escapeHtml(fullName) || 'them'} directly &mdash; this message is addressed back to the sender.</p>`

  const text = [
    `New message from ${siteLabel()}`,
    '',
    `From: ${fullName || '(no name given)'}`,
    `Reply to: ${email}`,
    `Subject: ${subject}`,
    ...(sourceSlug ? [`Came from: /blog/${sourceSlug}`] : []),
    ...(heardAbout ? [`Heard about me via: ${heardAbout}`] : []),
    '',
    message,
  ].join('\n')

  return {
    // Prefixed rather than passed through: the raw value is visitor-controlled, and an
    // unmarked subject line makes a relayed spam run look like the owner's own mail.
    subject: `Portfolio contact: ${subject}`,
    html: shell({
      preheader: `${fullName || email}: ${subject}`,
      eyebrow: 'Contact form',
      heading: 'New message from your portfolio',
      bodyHtml,
    }),
    text,
  }
}
