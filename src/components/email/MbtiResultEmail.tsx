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
import type { TypeContent } from '@/lib/mbti/content/types'
import { AXES, type Axis } from '@/lib/mbti/types'
import { ATTEMPT_TTL_DAYS } from '@/models/Attempt'

/**
 * The paid MBTI result, delivered by email.
 *
 * Styled to match the site's editorial surface, but built to email rules rather than web
 * rules: inline styles only (a `<style>` block is stripped or ignored by Outlook), tables
 * for the axis bars (no flexbox, no grid), a fixed 600px card, and resolved hex from
 * `theme.ts` instead of the site's CSS variables.
 *
 * This is the buyer's durable copy. The result URL still works and is linked here, but the
 * type, the breakdown, and the overview are all inlined so the email is worth something on
 * its own even after the link expires.
 */

export type MbtiResultEmailProps = {
  locale: Locale
  type: string
  content: TypeContent
  scores: Record<Axis, { a: number; b: number }>
  resultUrl: string
}

const COPY = {
  vi: {
    preview: 'Kết quả MBTI của bạn',
    eyebrow: 'Nhóm tính cách của bạn',
    breakdown: 'Chi tiết từng cặp',
    cta: 'Xem kết quả đầy đủ',
    /**
     * Says plainly that the email outlives the link. `{days}` comes from
     * `ATTEMPT_TTL_DAYS`, the same constant the privacy notice and result page use.
     */
    keepLink:
      'Giữ lại email này - đây là bản lưu vĩnh viễn của bạn. Đường dẫn ở trên sẽ ngừng hoạt động sau {days} ngày, khi dữ liệu bài làm được xóa khỏi hệ thống.',
    footer: 'Bạn nhận được email này vì đã mua kết quả MBTI đầy đủ.',
  },
  en: {
    preview: 'Your MBTI result',
    eyebrow: 'Your type',
    breakdown: 'Axis breakdown',
    cta: 'Open the full result',
    /** See the Vietnamese entry: `{days}` comes from `ATTEMPT_TTL_DAYS`. */
    keepLink:
      'Keep this email - it is your permanent copy. The link above stops working after {days} days, when your answers are deleted from the system.',
    footer: 'You are receiving this because you purchased a full MBTI result.',
  },
} as const

function AxisBar({ axis, score }: { axis: Axis; score: { a: number; b: number } }) {
  const total = score.a + score.b
  const aPercent = total > 0 ? Math.round((score.a / total) * 100) : 50
  const leansA = aPercent >= 50

  return (
    <table
      width='100%'
      cellPadding={0}
      cellSpacing={0}
      role='presentation'
      style={{ marginBottom: '14px' }}
    >
      <tbody>
        <tr>
          <td
            style={{
              fontFamily: EMAIL_FONT.display,
              fontSize: '13px',
              fontWeight: 600,
              color: leansA ? EMAIL_COLOR.text : EMAIL_COLOR.muted,
            }}
          >
            {axis[0]} {aPercent}%
          </td>
          <td
            align='right'
            style={{
              fontFamily: EMAIL_FONT.display,
              fontSize: '13px',
              fontWeight: 600,
              color: leansA ? EMAIL_COLOR.muted : EMAIL_COLOR.text,
            }}
          >
            {100 - aPercent}% {axis[1]}
          </td>
        </tr>
        <tr>
          <td colSpan={2} style={{ paddingTop: '6px' }}>
            {/*
              A two-cell table, not a div with a nested width. Outlook collapses a
              percentage-width div inside a table cell, which would render every bar full.
            */}
            <table
              width='100%'
              cellPadding={0}
              cellSpacing={0}
              role='presentation'
              style={{
                backgroundColor: EMAIL_COLOR.track,
                borderRadius: '999px',
                overflow: 'hidden',
              }}
            >
              <tbody>
                <tr>
                  <td
                    width={`${aPercent}%`}
                    style={{ backgroundColor: EMAIL_COLOR.violet, height: '8px', lineHeight: '8px' }}
                  >
                    &nbsp;
                  </td>
                  <td
                    width={`${100 - aPercent}%`}
                    style={{ height: '8px', lineHeight: '8px' }}
                  >
                    &nbsp;
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export default function MbtiResultEmail({
  locale,
  type,
  content,
  scores,
  resultUrl,
}: MbtiResultEmailProps) {
  const copy = COPY[locale]

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{`${copy.preview}: ${type} - ${content.nickname}`}</Preview>
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
              fontSize: '56px',
              lineHeight: 1,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: EMAIL_COLOR.text,
              margin: '10px 0 0',
            }}
          >
            {type}
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
            {content.nickname}
          </Text>

          <Text style={{ fontSize: '16px', lineHeight: 1.6, color: EMAIL_COLOR.muted, margin: '14px 0 0' }}>
            {content.tagline}
          </Text>

          <Hr style={{ borderColor: EMAIL_COLOR.line, margin: '28px 0' }} />

          <Text
            style={{
              fontFamily: EMAIL_FONT.display,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: EMAIL_COLOR.muted,
              margin: '0 0 16px',
            }}
          >
            {copy.breakdown}
          </Text>

          {AXES.map(axis => (
            <AxisBar key={axis} axis={axis} score={scores[axis]} />
          ))}

          <Hr style={{ borderColor: EMAIL_COLOR.line, margin: '28px 0' }} />

          {content.overview.map(paragraph => (
            <Text
              key={paragraph}
              style={{ fontSize: '15px', lineHeight: 1.7, color: EMAIL_COLOR.muted, margin: '0 0 14px' }}
            >
              {paragraph}
            </Text>
          ))}

          <Section style={{ margin: '28px 0 0' }}>
            {/*
              A padded anchor rather than react-email's <Button>: Outlook ignores padding on
              an <a>, and a table-cell button is the standard workaround. This keeps the
              pill shape everywhere else and degrades to a plain link where it does not.
            */}
            <table cellPadding={0} cellSpacing={0} role='presentation'>
              <tbody>
                <tr>
                  <td
                    style={{
                      backgroundColor: EMAIL_COLOR.text,
                      borderRadius: '999px',
                      padding: '14px 28px',
                    }}
                  >
                    <Link
                      href={resultUrl}
                      style={{
                        fontFamily: EMAIL_FONT.display,
                        fontSize: '13px',
                        fontWeight: 600,
                        letterSpacing: '0.16em',
                        textTransform: 'uppercase',
                        color: EMAIL_COLOR.page,
                        textDecoration: 'none',
                      }}
                    >
                      {copy.cta}
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Text style={{ fontSize: '13px', lineHeight: 1.6, color: EMAIL_COLOR.muted, margin: '20px 0 0' }}>
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
