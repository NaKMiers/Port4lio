import type { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

import { checkRateLimit, clientIpFrom, SUBMIT_LIMIT } from '@/lib/rate-limit'

/**
 * The IP extraction and the no-IP path, which decide whether a real visitor gets
 * throttled by somebody else's traffic.
 *
 * The Mongo-backed counting path is not covered here - it needs a database and belongs
 * in tests/api. What is covered is the branch that runs BEFORE any query, which is the
 * one that can silently 429 real people.
 */

function requestWith(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest
}

describe('clientIpFrom', () => {
  it('takes the leftmost entry of x-forwarded-for', () => {
    // Proxies append; the client is first. Taking the last entry would key every
    // request to the proxy itself, collapsing all visitors into one bucket.
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe(
      '203.0.113.7'
    )
  })

  it('trims surrounding whitespace', () => {
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '  203.0.113.7  , 10.0.0.1' }))).toBe(
      '203.0.113.7'
    )
  })

  it('falls back to x-real-ip', () => {
    expect(clientIpFrom(requestWith({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('prefers x-forwarded-for over x-real-ip', () => {
    expect(
      clientIpFrom(requestWith({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.9' }))
    ).toBe('203.0.113.7')
  })

  it('returns null when no usable header is present', () => {
    expect(clientIpFrom(requestWith({}))).toBeNull()
  })

  it('returns null rather than an empty string for blank headers', () => {
    // An empty string is falsy but would still key a bucket if it slipped through as ''.
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '' }))).toBeNull()
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '   ' }))).toBeNull()
    expect(clientIpFrom(requestWith({ 'x-real-ip': '  ' }))).toBeNull()
  })
})

describe('checkRateLimit with no identifiable caller', () => {
  it('fails open instead of throttling everyone into one bucket', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // No database call happens on this path, so this passes without a Mongo connection.
    // That is the point: the guard returns before any query.
    const result = await checkRateLimit(null, SUBMIT_LIMIT)

    expect(result.ok).toBe(true)
    expect(result.retryAfterSeconds).toBe(0)
    // Failing open must be visible, not silent - otherwise a proxy misconfiguration
    // disables rate limiting entirely with nothing in the logs to say so.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no client IP'))

    warn.mockRestore()
  })

  it('stays open across repeated calls, never accumulating a shared count', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 25; i += 1) {
      expect((await checkRateLimit(null, SUBMIT_LIMIT)).ok).toBe(true)
    }
    vi.restoreAllMocks()
  })
})
