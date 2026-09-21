import { NextResponse, type NextRequest } from 'next/server'

import { jsonError } from '@/lib/api-response'
import { renderMarkdown } from '@/lib/blog/markdown'
import { readJsonBody } from '@/lib/read-json-body'
import { requireOwner } from '@/lib/require-owner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Same bound as PATCH: the preview renders the same body the save would. */
const PREVIEW_MAX_BODY_BYTES = 512 * 1024

/**
 * [POST] /api/admin/blog/preview - render markdown without saving anything.
 *
 * ## Why a sixth handler exists at all
 *
 * The editor is a split pane: source on the left, rendered output on the right, updating as
 * the author types. The obvious implementation is to render in the browser, and it is
 * impossible here - `lib/blog/markdown.ts` starts with `import 'server-only'`, which is not
 * a style choice. Rendering in the client would mean shipping remark, rehype, the sanitize
 * schema and every Shiki grammar to a browser, and it would mean the sanitizer that decides
 * what is safe running somewhere the author controls. The whole security argument for the
 * pipeline is that it runs once, on the server, before storage.
 *
 * So the preview needs a server round trip, and this is it. It renders and returns; it
 * touches no database and creates nothing.
 *
 * ## Why it is gated, which is less obvious than it sounds
 *
 * This endpoint writes nothing, so "it is read-only, why gate it" is a reasonable question
 * with a bad answer. Ungated, it is a **free stored-XSS harness aimed at our own sanitizer**:
 * an anonymous caller can post arbitrary markdown and read back exactly what the pipeline
 * produced, as many times as they like, with no rate limit worth speaking of and no trace in
 * any post. That is the ideal tool for finding a sanitizer bypass - fast feedback, no
 * cleanup, no audit trail - and the bypass then gets used somewhere that matters.
 *
 * It is also unmetered CPU: every call pays Shiki. Gating closes both.
 *
 * `requireOwner` is the first statement, and `tests/e2e` asserts 401 on all six handlers
 * individually rather than on "the pattern", because a pattern is not a control.
 */
export async function POST(request: NextRequest) {
  const denied = requireOwner(request)
  if (denied) return denied

  const parsed = await readJsonBody<{ markdown?: unknown; slug?: unknown }>(
    request,
    {
      maxBytes: PREVIEW_MAX_BODY_BYTES,
    }
  )
  if (!parsed.ok) return jsonError(parsed.error, parsed.status)

  const markdown =
    typeof parsed.body?.markdown === 'string' ? parsed.body.markdown : ''
  // Only ever used in a log line if a fence fails to highlight. The editor sends the real
  // slug so those logs are attributable; a missing one is not worth a 400.
  const slug =
    typeof parsed.body?.slug === 'string' ? parsed.body.slug : '(preview)'

  try {
    const html = await renderMarkdown(markdown, slug)
    return NextResponse.json({ html })
  } catch (error) {
    // `renderMarkdown` does not throw for content reasons - unknown fences are downgraded
    // before Shiki sees them. Reaching here means the pipeline itself is broken, which the
    // author needs to see as a failed preview rather than as a blank pane.
    console.error('[api/admin/blog/preview] render failed', error)
    return jsonError('Could not render that markdown.', 500)
  }
}
