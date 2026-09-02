import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import IqResultEmail from '@/components/email/IqResultEmail'

/**
 * The paid IQ email renders, in both locales, with everything the buyer paid for in it.
 *
 * Worth a test because this template is only ever exercised by a real payment: a crash or a
 * missing link here surfaces as `PAID BUT UNDELIVERED` in the logs of a transaction that has
 * already taken someone's money.
 *
 * The certificate link is asserted separately from the result link because they are
 * different kinds of URL - one is a credential, the other is public - and a template that
 * printed the token in place of the certificate id would leak the buyer's private result
 * into a page designed to be shared.
 */

const PROPS = {
  score: 128,
  percentile: 97,
  raw: 21,
  total: 26,
  bandLabel: 'Superior',
  certificateName: 'Nguyễn Văn A',
  resultUrl: 'https://example.test/vi/iq/result/AbCd1234EfGh5678IjKl90',
  certificateUrl: 'https://example.test/vi/iq/certificate/ZzYy9876XxWw5432VvUu10',
}

describe('IqResultEmail', () => {
  it('renders the score, the band and both links', async () => {
    const html = await render(IqResultEmail({ locale: 'vi', ...PROPS }))

    expect(html).toContain('128')
    expect(html).toContain('Superior')
    expect(html).toContain('Nguyễn Văn A')
    expect(html).toContain(PROPS.resultUrl)
    expect(html).toContain(PROPS.certificateUrl)
  })

  it('interpolates the percentile and raw score rather than leaving placeholders', async () => {
    const text = await render(IqResultEmail({ locale: 'en', ...PROPS }), { plainText: true })

    expect(text).toContain('97')
    expect(text).toContain('21')
    expect(text).not.toContain('{percentile}')
    expect(text).not.toContain('{raw}')
    expect(text).not.toContain('{name}')
    expect(text).not.toContain('{days}')
  })

  it('renders a plain-text alternative with the links intact', async () => {
    // A multipart message reads better in text-only clients and scores lower with spam
    // filters. A text part that dropped the links would be a dead end.
    const text = await render(IqResultEmail({ locale: 'vi', ...PROPS }), { plainText: true })

    expect(text).toContain(PROPS.resultUrl)
    expect(text).toContain(PROPS.certificateUrl)
  })
})
