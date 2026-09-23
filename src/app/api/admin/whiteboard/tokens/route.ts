import type { NextRequest } from 'next/server'

import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'
import { noStore, wbError, wbJson } from '@/lib/whiteboard/http'
import { isSingleLine } from '@/lib/whiteboard/limits'
import { createToken, listTokens } from '@/lib/whiteboard/token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * [GET]  /api/admin/whiteboard/tokens - `{ id, name, prefix, createdAt, lastUsedAt, revokedAt }[]`
 * [POST] /api/admin/whiteboard/tokens - `{ name }`, returns the plaintext token ONCE
 *
 * The list never carries the hash, and the plaintext exists only in the POST response -
 * which is why that response is `no-store` like every other one here. The Agents panel polls
 * GET every 5 s while a fresh token is unused, to flip to "Connected" (DR5).
 */
export async function GET(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  try {
    return wbJson({ tokens: await listTokens() })
  } catch (error) {
    console.error('[whiteboard] token list failed', error)
    return wbError('Unable to load tokens right now.', 500)
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return noStore(denied)

  const parsed = await readJsonBody<{ name?: unknown }>(request)
  if (!parsed.ok) return wbError(parsed.error, parsed.status)

  const name =
    typeof parsed.body?.name === 'string' ? parsed.body.name.trim() : ''
  if (!name || name.length > 80 || !isSingleLine(name))
    return wbError('A token needs a one-line name of up to 80 characters.', 400)

  try {
    const { token, record } = await createToken(name)
    return wbJson({ token, record })
  } catch (error) {
    console.error('[whiteboard] token create failed', error)
    return wbError('Unable to create a token right now.', 500)
  }
}
