import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'

import {
  buildCreateLinkSignaturePayload,
  convertObjToQueryStr,
  createSignature,
  generatePayosOrderCode,
  signCreateLink,
  sortObjDataByKey,
  verifyPayosData,
} from '@/lib/payos'

/**
 * The webhook signature is the ONLY thing standing between the internet and "mark any
 * order paid". These tests pin the serialisation byte for byte, because it has to match
 * PayOS's reference implementation exactly - and a subtle mismatch does not fail loudly,
 * it fails as every real payment being rejected while the endpoint looks healthy.
 *
 * Ported from AnphaShop's `src/utils/payos.test.ts`.
 */

const CHECKSUM_KEY = 'test-checksum-key'

describe('payos signature serialisation', () => {
  it('sorts keys alphabetically', () => {
    expect(Object.keys(sortObjDataByKey({ zebra: 1, alpha: 2, mid: 3 }))).toEqual([
      'alpha',
      'mid',
      'zebra',
    ])
  })

  it('serialises to an alphabetical key=value query string', () => {
    expect(convertObjToQueryStr(sortObjDataByKey({ b: 2, a: 1, c: 3 }))).toBe('a=1&b=2&c=3')
  })

  it('collapses null-ish values to an empty string', () => {
    // Including the literal STRINGS 'null' and 'undefined', which PayOS treats the same as
    // the real values. Dropping this branch silently changes the signed payload.
    expect(
      convertObjToQueryStr({
        a: null,
        b: undefined,
        c: 'null',
        d: 'undefined',
        e: 'kept',
      })
    ).toBe('a=&c=&d=&e=kept')
  })

  it('drops undefined keys entirely rather than emitting them empty', () => {
    // `b=` would be a different payload and therefore a different signature.
    expect(convertObjToQueryStr({ a: 1, b: undefined })).toBe('a=1')
  })

  it('JSON-encodes arrays with each element key-sorted', () => {
    expect(convertObjToQueryStr({ items: [{ z: 1, a: 2 }] })).toBe('items=[{"a":2,"z":1}]')
  })
})

describe('verifyPayosData', () => {
  const data = {
    orderCode: 1_700_000_000_123,
    amount: 2000,
    description: 'MBTI ESTJ',
    reference: 'FT123',
  }

  function sign(payload: Record<string, unknown>, key = CHECKSUM_KEY): string {
    return createSignature(convertObjToQueryStr(sortObjDataByKey(payload)), key)
  }

  it('accepts a correctly signed payload', () => {
    expect(verifyPayosData(data, sign(data), CHECKSUM_KEY)).toBe(true)
  })

  it('accepts the same payload with keys in a different order', () => {
    // Key order over the wire is not something we control, so verification must not
    // depend on it.
    const reordered = {
      reference: data.reference,
      amount: data.amount,
      orderCode: data.orderCode,
      description: data.description,
    }
    expect(verifyPayosData(reordered, sign(data), CHECKSUM_KEY)).toBe(true)
  })

  it('rejects a tampered amount', () => {
    // The attack this exists to stop: pay 2000, claim 200000, or claim a payment never made.
    expect(verifyPayosData({ ...data, amount: 1 }, sign(data), CHECKSUM_KEY)).toBe(false)
  })

  it('rejects a signature made with a different checksum key', () => {
    expect(verifyPayosData(data, sign(data, 'other-key'), CHECKSUM_KEY)).toBe(false)
  })

  it('rejects a missing or non-string signature', () => {
    expect(verifyPayosData(data, undefined, CHECKSUM_KEY)).toBe(false)
    expect(verifyPayosData(data, '', CHECKSUM_KEY)).toBe(false)
    expect(verifyPayosData(data, 12345, CHECKSUM_KEY)).toBe(false)
  })

  it('fails closed when no checksum key is configured', () => {
    // An unconfigured deployment must reject everything, never accept everything.
    expect(verifyPayosData(data, sign(data), undefined)).toBe(false)
  })
})

describe('create-link signature', () => {
  const input = {
    amount: 2000,
    cancelUrl: 'https://example.com/cancel',
    description: 'MBTI ESTJ',
    orderCode: 1_700_000_000_123,
    returnUrl: 'https://example.com/return',
  }

  it('uses exactly the five documented keys in alphabetical order', () => {
    expect(buildCreateLinkSignaturePayload(input)).toBe(
      `amount=${input.amount}&cancelUrl=${input.cancelUrl}&description=${input.description}&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`
    )
  })

  it('matches an independently computed HMAC', () => {
    const expected = createHmac('sha256', CHECKSUM_KEY)
      .update(buildCreateLinkSignaturePayload(input))
      .digest('hex')

    expect(signCreateLink(input, CHECKSUM_KEY)).toBe(expected)
  })

  it('changes when any signed field changes', () => {
    const base = signCreateLink(input, CHECKSUM_KEY)
    expect(signCreateLink({ ...input, amount: 2001 }, CHECKSUM_KEY)).not.toBe(base)
    expect(signCreateLink({ ...input, orderCode: 1 }, CHECKSUM_KEY)).not.toBe(base)
    expect(signCreateLink({ ...input, description: 'other' }, CHECKSUM_KEY)).not.toBe(base)
  })
})

describe('generatePayosOrderCode', () => {
  it('returns a safe positive integer', async () => {
    const code = await generatePayosOrderCode(async () => false)
    expect(Number.isSafeInteger(code)).toBe(true)
    expect(code).toBeGreaterThan(0)
  })

  it('retries until it finds an unused code', async () => {
    let calls = 0
    const code = await generatePayosOrderCode(async () => {
      calls += 1
      return calls < 3
    })
    expect(calls).toBe(3)
    expect(Number.isSafeInteger(code)).toBe(true)
  })

  it('gives up rather than looping forever when every code collides', async () => {
    await expect(generatePayosOrderCode(async () => true, 3)).rejects.toThrow(
      /Could not allocate a payment reference/
    )
  })
})
