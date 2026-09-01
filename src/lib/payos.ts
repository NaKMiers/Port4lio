import { createHmac } from 'crypto'

/**
 * PayOS merchant API.
 *
 * Server-only. Never import this from a Client Component, and never log
 * `PAYOS_API_KEY` or `PAYOS_CHECKSUM_KEY` - the checksum key is what makes webhook
 * signatures unforgeable, so leaking it means anyone can mark any order paid.
 *
 * Ported from the AnphaShop implementation, trimmed to what this feature needs. The
 * signature serialisation below is copied deliberately verbatim; see the warning there.
 *
 * IMPORTANT, and the reason this file exists rather than reusing AnphaShop's account:
 * PayOS registers ONE webhook URL per merchant account. Pointing that URL here while
 * AnphaShop shares the account would stop AnphaShop's orders being fulfilled entirely.
 * This must run on its own PayOS merchant account.
 */

const PAYOS_BASE_URL = 'https://api-merchant.payos.vn'
const DEFAULT_TIMEOUT_MS = 15_000

/** PayOS writes `description` into the bank transfer memo, which the banks length-cap. */
export const PAYOS_DESCRIPTION_MAX_LENGTH = 25

export type PayosLinkStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'CANCELLED' | 'EXPIRED'

export type PayosCreateLinkInput = {
  orderCode: number
  amount: number
  description: string
  returnUrl: string
  cancelUrl: string
  /** Unix seconds. */
  expiredAt?: number
  buyerEmail?: string
}

export type PayosPaymentLink = {
  orderCode: number
  amount: number
  /**
   * NOT the `description` we sent. PayOS prefixes its own reference, so sending `MBTI123`
   * returns something like `CSGFGZX5EW6 MBTI123`. A manual bank transfer must carry THIS
   * string verbatim or PayOS cannot match the payment to the order.
   */
  description: string
  paymentLinkId: string
  checkoutUrl: string
  qrCode: string
  status: PayosLinkStatus
  currency?: string
  /** Virtual account, so transfer details can render on our own page instead of PayOS's. */
  bin?: string
  accountNumber?: string
  accountName?: string
}

export type PayosLinkInformation = {
  id: string
  orderCode: number
  amount: number
  amountPaid: number
  amountRemaining: number
  status: PayosLinkStatus
  transactions?: {
    reference?: string
    amount?: number
    transactionDateTime?: string
  }[]
}

export type PayosWebhookData = {
  orderCode: number
  amount: number
  description: string
  reference: string
  transactionDateTime: string
  code: string
  desc: string
  [key: string]: unknown
}

export type PayosWebhookBody = {
  code: string
  desc: string
  success?: boolean
  data: PayosWebhookData
  signature: string
}

export class PayosError extends Error {
  code: string

  constructor(message: string, code: string = 'unknown') {
    super(message)
    this.name = 'PayosError'
    this.code = code
  }
}

// MARK: Config

/** Kill switch. An unconfigured deployment must never show a paywall it cannot honour. */
export function isPayosConfigured(): boolean {
  return !!(
    process.env.PAYOS_CLIENT_ID &&
    process.env.PAYOS_API_KEY &&
    process.env.PAYOS_CHECKSUM_KEY
  )
}

// MARK: Signature helpers

/**
 * Faithful port of PayOS's reference implementation.
 *
 * The serialisation must match theirs byte for byte or every signature check fails, so
 * resist tidying it: the alphabetical key order, the array-before-null branch order, and
 * dropping `undefined` keys entirely rather than emitting them empty are all load-bearing.
 * `tests/unit/payos-signature.test.ts` pins each of those behaviours for exactly this
 * reason.
 */
export function sortObjDataByKey<T extends Record<string, unknown>>(object: T): T {
  return Object.keys(object)
    .sort()
    .reduce((obj: Record<string, unknown>, key) => {
      obj[key] = object[key]
      return obj
    }, {}) as T
}

export function convertObjToQueryStr(object: Record<string, unknown>): string {
  return Object.keys(object)
    .filter(key => object[key] !== undefined)
    .map(key => {
      let value: unknown = object[key]

      // Nested arrays are JSON-encoded with each element's keys sorted.
      if (Array.isArray(value)) {
        value = JSON.stringify(
          value.map(val =>
            val && typeof val === 'object' ? sortObjDataByKey(val as Record<string, unknown>) : val
          )
        )
      }

      // Null-ish values collapse to an empty string - including the STRINGS 'null' and
      // 'undefined', which PayOS treats the same as the real thing.
      if (value === null || value === undefined || value === 'null' || value === 'undefined') {
        value = ''
      }

      return `${key}=${value}`
    })
    .join('&')
}

export function createSignature(payload: string, checksumKey: string): string {
  return createHmac('sha256', checksumKey).update(payload).digest('hex')
}

/** Constant-time compare, so a mismatching signature leaks no timing information. */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Signature for `POST /v2/payment-requests`: exactly these five keys, alphabetical. */
export function buildCreateLinkSignaturePayload(input: {
  amount: number
  cancelUrl: string
  description: string
  orderCode: number
  returnUrl: string
}): string {
  return `amount=${input.amount}&cancelUrl=${input.cancelUrl}&description=${input.description}&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`
}

export function signCreateLink(
  input: {
    amount: number
    cancelUrl: string
    description: string
    orderCode: number
    returnUrl: string
  },
  checksumKey: string
): string {
  return createSignature(buildCreateLinkSignaturePayload(input), checksumKey)
}

/**
 * Verifies a webhook `data` object against its signature.
 *
 * This IS the authentication for the webhook route - there is no session on a
 * server-to-server callback. Everything it can reject, it rejects: a missing checksum key
 * fails closed rather than accepting anything.
 */
export function verifyPayosData(
  data: Record<string, unknown>,
  signature: unknown,
  checksumKey: string | undefined = process.env.PAYOS_CHECKSUM_KEY
): boolean {
  if (!checksumKey) return false
  if (typeof signature !== 'string' || signature.length === 0) return false
  if (!data || typeof data !== 'object') return false

  const expected = createSignature(convertObjToQueryStr(sortObjDataByKey(data)), checksumKey)

  return safeEquals(expected, signature)
}

// MARK: Order code

/**
 * PayOS requires a unique integer order code per merchant.
 *
 * Millisecond timestamp plus jitter, which stays well inside `Number.MAX_SAFE_INTEGER`
 * for the next few centuries. `isTaken` is injected rather than querying here so this
 * stays database-free and testable.
 */
export async function generatePayosOrderCode(
  isTaken: (orderCode: number) => Promise<boolean>,
  attempts: number = 5
): Promise<number> {
  for (let i = 0; i < attempts; i += 1) {
    const orderCode = Date.now() * 1000 + Math.floor(Math.random() * 1000)
    if (!(await isTaken(orderCode))) return orderCode
  }

  throw new PayosError('Could not allocate a payment reference', 'order-code-exhausted')
}

// MARK: API client

function authHeaders(): Record<string, string> {
  return {
    'x-client-id': process.env.PAYOS_CLIENT_ID as string,
    'x-api-key': process.env.PAYOS_API_KEY as string,
    'Content-Type': 'application/json',
  }
}

async function payosRequest<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = { method: 'GET' }
): Promise<T> {
  if (!isPayosConfigured()) {
    throw new PayosError('Payment gateway is not configured', 'not-configured')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let payload: { code?: string; desc?: string; data?: T } | null = null

  try {
    const response = await fetch(`${PAYOS_BASE_URL}${path}`, {
      method: init.method,
      headers: authHeaders(),
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })

    // Classified without echoing the response body, which can carry payment details into
    // logs that are usually less protected than the database.
    if (response.status === 401) {
      throw new PayosError('Payment gateway rejected our credentials', 'unauthorized')
    }
    if (response.status === 429) {
      throw new PayosError('Payment gateway is rate limiting us', 'rate-limited')
    }

    payload = await response.json()
  } catch (error) {
    if (error instanceof PayosError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PayosError('Payment gateway did not respond', 'timeout')
    }
    throw new PayosError('Could not reach the payment gateway', 'network-error')
  } finally {
    clearTimeout(timer)
  }

  if (!payload || payload.code !== '00') {
    throw new PayosError(payload?.desc || 'Payment gateway returned an error', payload?.code || 'unknown')
  }

  if (!payload.data) {
    throw new PayosError('Payment gateway returned no data', 'empty-data')
  }

  return payload.data
}

export async function createPaymentLink(input: PayosCreateLinkInput): Promise<PayosPaymentLink> {
  const description = input.description.slice(0, PAYOS_DESCRIPTION_MAX_LENGTH)
  const amount = Math.round(input.amount)

  const signature = signCreateLink(
    {
      amount,
      cancelUrl: input.cancelUrl,
      description,
      orderCode: input.orderCode,
      returnUrl: input.returnUrl,
    },
    process.env.PAYOS_CHECKSUM_KEY as string
  )

  return await payosRequest<PayosPaymentLink>('/v2/payment-requests', {
    method: 'POST',
    body: {
      orderCode: input.orderCode,
      amount,
      description,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      ...(input.expiredAt ? { expiredAt: input.expiredAt } : {}),
      ...(input.buyerEmail ? { buyerEmail: input.buyerEmail } : {}),
      signature,
    },
  })
}

export async function getPaymentLinkInformation(id: string | number): Promise<PayosLinkInformation> {
  return await payosRequest<PayosLinkInformation>(`/v2/payment-requests/${id}`)
}

/**
 * One-time setup per environment: tells PayOS where to send payment results.
 *
 * Not called from application code - run it once by hand after deploying, and only against
 * this feature's own merchant account. See the warning at the top of this file.
 */
export async function confirmWebhook(webhookUrl: string): Promise<unknown> {
  return await payosRequest<unknown>('/confirm-webhook', {
    method: 'POST',
    body: { webhookUrl },
  })
}
