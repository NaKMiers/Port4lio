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
