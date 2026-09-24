import { NextResponse } from 'next/server'

/**
 * The single JSON error shape every route handler returns.
 *
 * Extracted from `api/profile/route.ts`, which defined it locally, before the MBTI routes
 * grew four more copies of the same three lines. Callers pass a message safe to show a
 * user - never an exception's raw text, which can carry connection strings.
 */
export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

/**
 * A service's refusal as the route's JSON error. `extra` rides beside `error` when a route
 * has always sent more than the message (a count the client shows, a conflict code).
 */
export function serviceErrorResponse(failure: {
  status: number
  error: string
  extra?: Record<string, unknown>
}) {
  if (!failure.extra) return jsonError(failure.error, failure.status)
  return NextResponse.json(
    { error: failure.error, ...failure.extra },
    { status: failure.status }
  )
}
