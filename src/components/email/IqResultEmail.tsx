import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

import { EMAIL_CARD_WIDTH, EMAIL_COLOR, EMAIL_FONT } from '@/components/email/theme'
import type { Locale } from '@/lib/i18n'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * The paid IQ result, delivered by email.
 *
 * Same email rules as `MbtiResultEmail`: inline styles only, tables instead of flexbox, a
 * fixed 600px card, resolved hex from `theme.ts` rather than the site's CSS variables.
 *
 * This is the buyer's durable copy, and it matters more here than it does for MBTI. The
 * result link dies with the attempt after {days} days, but the certificate does not - so
 * this email carries both, and the certificate link is the one that still works a year
 * later.
 */

export type IqResultEmailProps = {
  locale: Locale
  score: number
  percentile: number
  raw: number
  total: number
  bandLabel: string
  certificateName: string
  resultUrl: string
  certificateUrl: string
}

const COPY = {
  vi: {
    preview: 'Chỉ số IQ của bạn',
    eyebrow: 'Chỉ số IQ của bạn',
    /** `{percentile}` is interpolated. */
    percentile: 'Cao hơn {percentile}% dân số',
    /** `{raw}` and `{total}` are interpolated. */
    raw: 'Trả lời đúng {raw} / {total} câu',
    certificateHeading: 'Chứng nhận của bạn',
    /** `{name}` is the name the buyer chose at checkout. */
    certificateBody:
      'Chứng nhận công khai đã được cấp cho {name}. Bất kỳ ai giữ đường dẫn này đều có thể kiểm chứng nó.',
    certificateCta: 'Xem chứng nhận',
    cta: 'Mở kết quả đầy đủ',
    /** `{days}` comes from `ATTEMPT_TTL_DAYS`, the same constant the privacy notice uses. */
    keepLink:
      'Giữ lại email này. Đường dẫn kết quả sẽ ngừng hoạt động sau {days} ngày, khi dữ liệu bài làm được xóa. Đường dẫn chứng nhận thì không hết hạn.',
    footer: 'Bạn nhận được email này vì đã mua kết quả bài test IQ.',
  },
  en: {
    preview: 'Your IQ score',
    eyebrow: 'Your IQ score',
    percentile: 'Higher than {percentile}% of the population',
    raw: '{raw} of {total} correct',
    certificateHeading: 'Your certificate',
    certificateBody:
      'A public certificate has been issued to {name}. Anyone with this link can verify it.',
    certificateCta: 'View the certificate',
    cta: 'Open the full result',
    /** See the Vietnamese entry: `{days}` comes from `ATTEMPT_TTL_DAYS`. */
    keepLink:
      'Keep this email. The result link stops working after {days} days, when your answers are deleted. The certificate link does not expire.',
    footer: 'You are receiving this because you purchased an IQ test result.',
  },
} as const

/**
 * A padded anchor inside a table cell rather than react-email's `<Button>`: Outlook ignores
 * padding on an `<a>`, and a table-cell button is the standard workaround.
 */
function PillLink({ href, label, filled }: { href: string; label: string; filled: boolean }) {
  return (
    <table cellPadding={0} cellSpacing={0} role='presentation'>
      <tbody>
        <tr>
          <td
            style={{
              backgroundColor: filled ? EMAIL_COLOR.text : 'transparent',
              border: filled ? 'none' : `1px solid ${EMAIL_COLOR.line}`,
              borderRadius: '999px',
              padding: '14px 28px',
            }}
          >
            <Link
              href={href}
              style={{
                fontFamily: EMAIL_FONT.display,
                fontSize: '13px',
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: filled ? EMAIL_COLOR.page : EMAIL_COLOR.text,
                textDecoration: 'none',
              }}
            >
              {label}
            </Link>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export default function IqResultEmail({
  locale,
  score,
  percentile,
  raw,
  total,
  bandLabel,
  certificateName,
  resultUrl,
  certificateUrl,
}: IqResultEmailProps) {
  const copy = COPY[locale]

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{`${copy.preview}: ${score}`}</Preview>
      <Body
        style={{
          backgroundColor: EMAIL_COLOR.page,
          fontFamily: EMAIL_FONT.body,
          color: EMAIL_COLOR.text,
          margin: 0,
          padding: '24px 0',
        }}
      >
        <Container
          style={{
            width: `${EMAIL_CARD_WIDTH}px`,
            maxWidth: '100%',
            backgroundColor: EMAIL_COLOR.card,
            border: `1px solid ${EMAIL_COLOR.line}`,
            borderRadius: '20px',
            padding: '36px 40px',
          }}
        >
          <Text
            style={{
              fontFamily: EMAIL_FONT.display,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: EMAIL_COLOR.muted,
              margin: 0,
            }}
          >
            {copy.eyebrow}
          </Text>

          <Heading
            as='h1'
            style={{
              fontFamily: EMAIL_FONT.display,
              fontSize: '64px',
              lineHeight: 1,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: EMAIL_COLOR.text,
              margin: '10px 0 0',
            }}
          >
            {score}
          </Heading>

          <Text
            style={{
              fontFamily: EMAIL_FONT.display,
              fontSize: '19px',
              fontWeight: 600,
              color: EMAIL_COLOR.violet,
              margin: '10px 0 0',
            }}
          >
            {bandLabel}
          </Text>

          <Text
            style={{ fontSize: '16px', lineHeight: 1.6, color: EMAIL_COLOR.muted, margin: '14px 0 0' }}
          >
            {copy.percentile.replace('{percentile}', String(percentile))}
          </Text>
          <Text
            style={{ fontSize: '14px', lineHeight: 1.6, color: EMAIL_COLOR.muted, margin: '4px 0 0' }}
          >
            {copy.raw.replace('{raw}', String(raw)).replace('{total}', String(total))}
          </Text>

          <Section style={{ margin: '28px 0 0' }}>
            <PillLink href={resultUrl} label={copy.cta} filled />
          </Section>

          <Hr style={{ borderColor: EMAIL_COLOR.line, margin: '28px 0' }} />

          <Text
            style={{
              fontFamily: EMAIL_FONT.display,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: EMAIL_COLOR.muted,
              margin: '0 0 12px',
            }}
          >
            {copy.certificateHeading}
          </Text>
          <Text
            style={{ fontSize: '15px', lineHeight: 1.7, color: EMAIL_COLOR.muted, margin: '0 0 18px' }}
          >
            {copy.certificateBody.replace('{name}', certificateName)}
          </Text>
          <PillLink href={certificateUrl} label={copy.certificateCta} filled={false} />

          <Text
            style={{ fontSize: '13px', lineHeight: 1.6, color: EMAIL_COLOR.muted, margin: '24px 0 0' }}
          >
            {copy.keepLink.replace('{days}', String(ATTEMPT_TTL_DAYS))}
          </Text>

          <Hr style={{ borderColor: EMAIL_COLOR.line, margin: '28px 0 16px' }} />

          <Text style={{ fontSize: '12px', lineHeight: 1.6, color: EMAIL_COLOR.muted, margin: 0 }}>
            {copy.footer}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
