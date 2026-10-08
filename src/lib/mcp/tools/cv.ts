import 'server-only'

import { z } from 'zod'

import {
  createCv,
  deleteCv,
  getCv,
  listCvs,
  publishCv,
  publishedCvId,
  saveCv,
  type CvResult,
} from '@/lib/cv/cv-service'
import { defineTool, ok, refuse, type ToolResult } from '@/lib/mcp/run-tool'
import type { AgentContext } from '@/lib/mcp/token'
import { CV_LABEL_MAX, MAX_CVS } from '@/lib/upload-limits'

/**
 * The CV tools: the owner keeps several CVs and `/cv` prints the published one. Every tool
 * calls `lib/cv/cv-service.ts`, the module `/api/admin/cvs/**` calls, with `actor: 'agent'`
 * (multi-cv-plan.md Phase 2, R6, R7). Nothing here writes or revalidates on its own.
 *
 * ```
 *   read     list_cvs  ──▶ listCvs                     every CV (P2-C): id, label, published,
 *                                                      version, fitVerified
 *            get_cv    ──▶ getCv(id? = published)      the STORED resume + avatar + version
 *   write    create_cv ──▶ createCv(fromId? = published, actor agent)   keyed: a timeout retry
 *                                                      with the same clientRef makes one CV
 *            update_cv ──▶ publishedCvId: this CV live and no publish scope ──▶ refused 'scope'
 *                      ──▶ saveCv(version as base, actor agent, onlyIfUnpublished: no publish)
 *                      ──▶ published CV edited (re-read after the write) ──▶ fit warning
 *   publish  publish_cv ──▶ publishCv ──▶ fitVerified false ──▶ answer carries the fit warning
 *            delete_cv  ──▶ deleteCv  ──▶ the published CV ──▶ refused 'published'
 *
 *   version = the CV's updatedAt as ISO, the same stale guard Save CV sends as `base`
 *   service failure ──▶ refusal: stale · labelTaken · cap · published · not-found · invalid
 *   every call audited, target { kind: 'cv', id }
 * ```
 *
 * ## Why an unverified CV still publishes, with a warning (P2-A)
 *
 * `/cv` is fixed A4 and clips what runs long; only a browser can measure the fit, and the
 * server has none. An agent's write therefore leaves `fitVerified: false`, and publishing it
 * is allowed but says so, in words the agent can relay: the owner opens the CV in
 * `/admin/settings`, the editor re-fits the page break, and Save CV verifies it.
 *
 * ## Why update_cv checks the scope here AND passes onlyIfUnpublished (P2-B)
 *
 * Which scope a call needs depends on the CV, not the tool - blog's live-post rule. The
 * check up front gives a clear refusal; `onlyIfUnpublished` repeats it inside the write, so
 * the owner publishing this CV between the two cannot let a write-only token edit it live.
 *
 * ## Why get_cv returns the stored resume, and `'*'` is refused
 *
 * A derived resume carries the avatar URL in `photo`; written back, it would freeze the CV
 * to today's avatar. And `'*'` is the editor's deliberate "Overwrite anyway" - an agent
 * that lost a race re-reads instead.
 */

type CvFailure = Extract<CvResult<unknown>, { ok: false }>

const json = (value: unknown) => JSON.stringify(value, null, 2)

const canPublish = (token: AgentContext) => token.scopes.includes('publish')

export const FIT_WARNING =
  'Fit not verified: /cv may clip text. Ask the owner to open this CV in /admin/settings and Save CV.'

const LIVE_CV_REFUSAL =
  'This is the published CV, so changing it changes /cv, which needs the publish scope. This token does not have it. Tailor a copy instead (create_cv, then update_cv). Nothing was changed.'

/** A cv-service refusal as a teaching tool error, keeping a reason for the audit feed. */
function fromFailure(failure: CvFailure): ToolResult {
  switch (failure.extra?.code) {
    case 'stale':
      return refuse(
        'This CV changed since you read it - the owner or another agent saved it. Call get_cv again and retry with the new version. Nothing was changed.',
        'stale'
      )
    case 'labelTaken':
      return refuse(
        'Another CV already has this label (labels are unique, ignoring case). Pick a different one. Nothing was changed.',
        'labelTaken'
      )
    case 'cap':
      return refuse(
        `The owner already has ${MAX_CVS} CVs, the most the site keeps. Tailor an existing unpublished CV with update_cv, or ask the owner which one to delete. Nothing was changed.`,
        'cap'
      )
    case 'published':
      return refuse(
        'This is the published CV (the one /cv prints), and it cannot be deleted. Publish another CV first (publish_cv), then delete this one. Nothing was changed.',
        'published'
      )
  }
  if (failure.status === 404)
    return refuse(
      'No CV has this id. Call list_cvs for the ids. Nothing was changed.',
      'not-found'
    )
  return refuse(`${failure.error} Nothing was changed.`, 'invalid')
}

const cvId = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'must be a CV id from list_cvs')

// MARK: Reads

export const listCvsTool = defineTool({
  name: 'list_cvs',
  title: 'List the CVs',
  description:
    'Every CV the owner keeps, oldest first: id, label, whether it is the published one (the CV /cv prints), its version (pass it to update_cv) and fitVerified (false after an agent edited it, until the owner re-checks the page in /admin/settings). Call get_cv for one CV in full.',
  scopes: ['read'],
  audited: true,
  input: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run() {
    const { cvs, publishedId } = await listCvs()
    return ok(
      json({
        publishedId,
        cvs: cvs.map(cv => ({
          id: cv.id,
          label: cv.label,
          published: cv.id === publishedId,
          version: cv.updatedAt,
          updatedAt: cv.updatedAt,
          fitVerified: cv.fitVerified,
        })),
      })
    )
  },
})

export const getCvTool = defineTool({
  name: 'get_cv',
  title: 'Get one CV',
  description:
    "One CV in full, the published one when id is omitted. resume is the CV exactly as stored: photo '' means the masthead inherits the owner's portfolio avatar (given beside it) - keep it '' when you write the CV back, or the CV stops following the avatar. It includes the owner's own contact details. Keep version: update_cv needs it.",
  scopes: ['read'],
  audited: true,
  input: z.object({
    id: cvId
      .optional()
      .describe('A CV id from list_cvs. Omit for the published CV.'),
  }),
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run({ id }, { setTarget }) {
    const result = await getCv(id)
    if (!result.ok) return fromFailure(result)
    const { cv, published, avatar } = result.value
    setTarget({ kind: 'cv', id: cv.id })
    return ok(
      json({
        id: cv.id,
        label: cv.label,
        published,
        version: cv.updatedAt,
        fitVerified: cv.fitVerified,
        avatar,
        resume: cv.resume,
      })
    )
  },
})

// MARK: Writes

export const createCvTool = defineTool({
  name: 'create_cv',
  title: 'Create a CV',
  description: `A new CV, copied from fromId (default: the published CV) and named label (1-${CV_LABEL_MAX} characters, unique ignoring case). It is not published and /cv does not change. Edit it with update_cv. The owner keeps at most ${MAX_CVS} CVs.`,
  scopes: ['write'],
  keyed: true,
  input: z.object({
    label: z.string().trim().min(1).max(CV_LABEL_MAX),
    fromId: cvId
      .optional()
      .describe('The CV to copy. Omit to copy the published CV.'),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async run({ label, fromId }, { setTarget }) {
    const source = fromId ?? (await publishedCvId())
    if (!source)
      return refuse(
        'There is no published CV to copy. Pass fromId from list_cvs. Nothing was changed.',
        'not-found'
      )
    const result = await createCv({ label, fromId: source, actor: 'agent' })
    if (!result.ok) return fromFailure(result)
    const cv = result.value
    setTarget({ kind: 'cv', id: cv.id })
    return ok(
      json({
        id: cv.id,
        label: cv.label,
        version: cv.updatedAt,
        published: false,
        fitVerified: cv.fitVerified,
        copiedFrom: source,
        next: 'Call get_cv with this id, then update_cv with its version to tailor it.',
      })
    )
  },
})

export const updateCvTool = defineTool({
  name: 'update_cv',
  title: 'Edit a CV',
  description:
    "Change a CV's label, its content, or both, with the version get_cv or list_cvs gave you; a stale version is refused, so re-read and retry. resume is replaced WHOLE: send every field get_cv returned, with your edits (keep photo '' to keep following the avatar). New image URLs must be this site's Cloudinary; links must be https, http or mailto. /cv is a fixed A4 page and the server cannot tell whether new text fits, so every edit marks the CV fitVerified: false until the owner re-checks it in /admin/settings. The published CV needs the publish scope, and editing it changes /cv at once.",
  scopes: ['write'],
  audited: true,
  input: z.object({
    id: cvId,
    version: z
      .string()
      .min(1)
      .max(40)
      .describe('The version get_cv or list_cvs returned for this CV.'),
    label: z.string().trim().min(1).max(CV_LABEL_MAX).optional(),
    resume: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The whole CV, as get_cv returned it, with your edits.'),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async run({ id, version, label, resume }, { token, setTarget }) {
    setTarget({ kind: 'cv', id })
    if (version === '*')
      return refuse(
        "version must be the one get_cv or list_cvs returned; '*' (overwrite whatever is there) is not available to agents. Nothing was changed.",
        'invalid'
      )
    const base = new Date(version)
    if (Number.isNaN(base.getTime()))
      return refuse(
        'version must be the one get_cv or list_cvs returned for this CV. Nothing was changed.',
        'invalid'
      )
    if (label === undefined && resume === undefined)
      return refuse(
        'Send label, resume, or both. Nothing was changed.',
        'invalid'
      )

    const published = (await publishedCvId()) === id
    if (published && !canPublish(token)) return refuse(LIVE_CV_REFUSAL, 'scope')

    const result = await saveCv(id, {
      resume,
      label,
      base,
      actor: 'agent',
      onlyIfUnpublished: !canPublish(token),
    })
    if (!result.ok)
      // Published after the check above: the write itself refused it.
      return result.extra?.code === 'published'
        ? refuse(LIVE_CV_REFUSAL, 'scope')
        : fromFailure(result)

    const cv = result.value
    // Read again after the write: with the publish scope, a publish landing between the
    // check above and the write made this edit live, and the warning must say so.
    const live = (await publishedCvId()) === id
    return ok(
      json({
        id: cv.id,
        label: cv.label,
        version: cv.updatedAt,
        published: live,
        fitVerified: cv.fitVerified,
        ...(live ? { warning: FIT_WARNING } : {}),
      })
    )
  },
})

// MARK: Publish

export const publishCvTool = defineTool({
  name: 'publish_cv',
  title: 'Publish a CV',
  description:
    'Make this CV the one /cv prints, at once. The previously published CV stays, unpublished. A CV an agent edited has not had its page fit checked; publishing it is allowed, and the answer then carries a warning to pass on to the owner. Publish only when the owner asked for it.',
  scopes: ['publish'],
  audited: true,
  input: z.object({ id: cvId }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run({ id }, { setTarget }) {
    setTarget({ kind: 'cv', id })
    const result = await publishCv(id)
    if (!result.ok) return fromFailure(result)
    return ok(
      json({
        publishedId: result.value.publishedId,
        ...(result.value.fitVerified ? {} : { warning: FIT_WARNING }),
      })
    )
  },
})

export const deleteCvTool = defineTool({
  name: 'delete_cv',
  title: 'Delete a CV',
  description:
    'Delete a CV for good. The published CV cannot be deleted: publish another one first. Delete only when the owner asked for it.',
  scopes: ['publish'],
  audited: true,
  input: z.object({ id: cvId }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async run({ id }, { setTarget }) {
    setTarget({ kind: 'cv', id })
    const result = await deleteCv(id)
    if (!result.ok) return fromFailure(result)
    return ok(json({ ok: true, id }))
  },
})

export const CV_TOOLS = [
  listCvsTool,
  getCvTool,
  createCvTool,
  updateCvTool,
  publishCvTool,
  deleteCvTool,
]
