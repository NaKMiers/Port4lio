import 'server-only'

import crypto from 'node:crypto'

import type { ToolAnnotations } from '@modelcontextprotocol/server'
import { after } from 'next/server'
import { z } from 'zod'

import { clipToBudget } from '@/lib/mcp/budget'
import type { TokenScope } from '@/lib/mcp/scopes'
import type { AgentContext } from '@/lib/mcp/token'
import { checkRateLimit, type RateLimitOptions } from '@/lib/rate-limit'
import {
  AgentActionModel,
  agentActionExpiryFrom,
  type AgentActionTarget,
} from '@/models/AgentAction'

/**
 * `runTool`: the one wrapper around EVERY tool call, so no tool can forget a step.
 *
 * ```
 *   runTool(def, rawArgs, token)
 *     try:
 *       1 scope      def.scopes ∩ token.scopes empty ──▶ refused(scope)   the filter is not the gate
 *       2 zod        safeParse(rawArgs) fails       ──▶ refused(invalid) with a teaching message
 *       3 clientRef  (keyed tools, R4) insert { outcome: pending } under unique (tokenId, clientRef)
 *                      inserted       ──▶ this call runs
 *                      duplicate key  ──▶ existing row:
 *                        ok, same args, < 24 h   ──▶ replay its stored result
 *                        pending, < 10 min       ──▶ refused "still running, retry shortly"
 *                        different args          ──▶ refused "clientRef reused with different arguments"
 *                        refused | error | stale ──▶ take the row over (old row copied to history), run
 *       4 cost       checkRateLimit('mcp-token:<id>', def.cost(args)) ──▶ refused(rate)       (R5)
 *                      lazyCost tools spend it themselves via ctx.spend(), after their cheap checks
 *       5 run        def.run(args, ctx) ──▶ the same src/lib service /api/admin/** calls
 *       6 budget     clipToBudget: the net no tool is meant to reach (C10)
 *     finally:
 *       7 audited tools write EXACTLY ONE AgentAction row per call, whatever happened:
 *           keyed   ──▶ finalize the claimed row, awaited, retried, only if still this call's claim
 *           unkeyed ──▶ insert via after(), off the response path
 * ```
 *
 * ## Why the claim comes BEFORE the work (R4)
 *
 * The retry `clientRef` exists for is the one a client sends after a timeout, while the first
 * call is still running. Recording the key after the work would let both run - two drafts, or
 * two paid images. Inserting first under a unique index makes "who runs" one atomic write. A
 * failed attempt must stay retryable, so only an `ok` row replays; a `refused` or `error` row
 * is taken over by the retry. The takeover is a conditional update, so two retries racing for
 * the same failed row still produce one winner.
 *
 * ## Why a takeover copies the old row first
 *
 * "One row per audited call" is what makes the feed in `/admin/agents` trustworthy - a refused
 * call that later succeeded on retry is two calls, and the owner should see both. Resetting
 * the keyed row in place would erase the first one, so its content is re-inserted without the
 * key before the reset.
 *
 * ## Why input is validated here and not by the SDK
 *
 * The SDK would reject bad arguments before our code runs, which means no audit row for a
 * `refused(invalid)` call and an error message written for a developer, not for the agent.
 * `server.ts` hands the SDK a schema that advertises the real JSON Schema but accepts
 * anything, and this step does the real parse.
 */

// MARK: Definitions

export type ToolOutcome = 'ok' | 'refused' | 'error'

export interface ToolResult {
  text: string
  outcome: ToolOutcome
  /** Why a refusal or error happened, for the feed: 'scope', 'invalid', 'rate', 'live-post'... */
  reason?: string
}

export const ok = (text: string): ToolResult => ({ text, outcome: 'ok' })

/** A refusal the agent can fix: the message says how. */
export const refuse = (text: string, reason = 'invalid'): ToolResult => ({
  text,
  outcome: 'refused',
  reason,
})

export interface ToolRunContext {
  token: AgentContext
  /** What the call was about, for the audit row (a post, a card, an order). */
  setTarget(target: AgentActionTarget): void
  /**
   * Spend the call's `cost` buckets now, once. For a `lazyCost` tool, called right before the
   * paid step, so a call refused by its own cheap checks spends nothing. `null` = spent;
   * otherwise the refusal to return. A no-op after the first call, and for other tools.
   */
  spend(): Promise<ToolResult | null>
}

/** `z.ZodObject` with its shape erased, the one form a registry array can hold. */
type AnyObjectSchema = z.ZodObject<z.ZodRawShape>

export interface ToolDefinition<S extends AnyObjectSchema = AnyObjectSchema> {
  name: string
  title: string
  description: string
  /** ANY one of these lets a token call the tool (C5). */
  scopes: readonly TokenScope[]
  input: S
  annotations: ToolAnnotations
  /** Every write tool, plus `find_order`: one AgentAction row per call. */
  audited?: boolean
  /** Accepts `clientRef` (R4). Implies `audited`. */
  keyed?: boolean
  /** Per-token buckets this call spends (R5). */
  cost?: (args: z.output<S>) => readonly RateLimitOptions[]
  /**
   * true: `cost` is spent when `run` calls `ctx.spend()`, not before `run` starts - for a tool
   * whose cheap refusals (a missing target, a live post) would otherwise burn a paid unit.
   */
  lazyCost?: boolean
  run(args: z.output<S>, ctx: ToolRunContext): Promise<ToolResult>
}

export type AnyToolDefinition = ToolDefinition

const CLIENT_REF_SCHEMA = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe(
    'Optional retry key you choose, e.g. a UUID. A retry with the same clientRef and the same arguments returns the first successful result instead of acting twice.'
  )

/**
 * Erase a tool's argument type so the registry can hold it. A keyed tool gets `clientRef`
 * added to its schema here, so it appears in `tools/list` like any other argument.
 */
export function defineTool<S extends AnyObjectSchema>(
  def: ToolDefinition<S>
): AnyToolDefinition {
  const input = def.keyed
    ? def.input.extend({ clientRef: CLIENT_REF_SCHEMA })
    : def.input
  return {
    ...def,
    audited: def.audited || def.keyed,
    input,
  } as unknown as AnyToolDefinition
}

export function hasAnyScope(
  scopes: readonly TokenScope[],
  token: Pick<AgentContext, 'scopes'>
): boolean {
  return scopes.some(scope => token.scopes.includes(scope))
}

// MARK: Previews and hashes

const EMAIL = /[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[A-Za-z]{2,}/g
const PREVIEW_MAX_BYTES = 2048
const LONG_STRING = 200
const PREVIEW_MAX_DEPTH = 8

/**
 * At most 2 KB, long strings (markdown bodies) as their length, emails masked - in keys as
 * well as values, because a refusal previews the raw, unparsed arguments.
 */
export function previewArgs(args: unknown): string {
  const mask = (text: string) =>
    text.length > LONG_STRING
      ? `[${text.length} chars]`
      : text.replace(EMAIL, '[email]')
  // Depth-capped: this runs on raw, unparsed arguments before anything else, so a deeply
  // nested body must become a marker, not a stack overflow outside the call's try.
  const walk = (value: unknown, depth = 0): unknown => {
    if (depth > PREVIEW_MAX_DEPTH) return '[nested]'
    if (typeof value === 'string') return mask(value)
    if (Array.isArray(value)) return value.map(entry => walk(entry, depth + 1))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          mask(key),
          walk(entry, depth + 1),
        ])
      )
    return value
  }
  let json = JSON.stringify(walk(args ?? {})) ?? ''
  while (Buffer.byteLength(json) > PREVIEW_MAX_BYTES)
    json = `${json.slice(0, Math.floor(json.length * 0.9))}...`
  return json
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function hashArgs(args: Record<string, unknown>): string {
  const { clientRef: _clientRef, ...rest } = args
  return crypto.createHash('sha256').update(stableStringify(rest)).digest('hex')
}

// MARK: Teaching errors

function describeIssues(tool: string, error: z.ZodError): string {
  const lines = error.issues.map(issue => {
    const path = issue.path.map(String).join('.') || '(arguments)'
    return `- ${path}: ${issue.message}`
  })
  return [
    `Invalid arguments for ${tool}. Nothing was changed.`,
    ...lines,
    'Fix these and call it again; the tool description lists every argument.',
  ].join('\n')
}

// MARK: Audit rows

interface AuditRow {
  tool: string
  outcome: ToolOutcome
  reason: string | null
  target: AgentActionTarget | null
  argsPreview: string
}

function baseRow(token: AgentContext, row: AuditRow, now: Date) {
  return {
    tokenId: token.tokenId,
    tokenName: token.name,
    tool: row.tool,
    outcome: row.outcome,
    reason: row.reason,
    target: row.target,
    argsPreview: row.argsPreview,
    at: now,
    expireAt: agentActionExpiryFrom(now),
  }
}

/** An unkeyed row, written after the response so it never delays the answer. */
function recordLater(token: AgentContext, row: AuditRow) {
  const now = new Date()
  after(async () => {
    try {
      await AgentActionModel.create(baseRow(token, row, now))
    } catch (error) {
      console.error(`[mcp] audit row for ${row.tool} failed`, error)
    }
  })
}

/** R1: a call to a registry tool this token cannot see still leaves a `refused` row. */
export function recordScopeRefusal(
  token: AgentContext,
  tool: string,
  rawArgs: unknown
) {
  recordLater(token, {
    tool,
    outcome: 'refused',
    reason: 'scope',
    target: null,
    argsPreview: previewArgs(rawArgs),
  })
}

// MARK: The clientRef claim (R4)

const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000
/** A pending claim older than this belongs to a function the platform killed (maxDuration 300 s). */
const ABANDONED_CLAIM_MS = 10 * 60 * 1000

type Claim =
  | { kind: 'claimed'; rowId: string; at: Date }
  | { kind: 'replay'; text: string }
  | { kind: 'busy' }
  | { kind: 'mismatch' }

function isDuplicateKey(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  )
}

async function claim(
  token: AgentContext,
  tool: string,
  clientRef: string,
  argsHash: string,
  argsPreview: string,
  attempt = 0
): Promise<Claim> {
  const now = new Date()
  try {
    const row = await AgentActionModel.create({
      ...baseRow(
        token,
        { tool, outcome: 'ok', reason: null, target: null, argsPreview },
        now
      ),
      outcome: 'pending',
      clientRef,
      argsHash,
    })
    return { kind: 'claimed', rowId: String(row._id), at: now }
  } catch (error) {
    if (!isDuplicateKey(error)) throw error
  }

  const existing = await AgentActionModel.findOne({
    tokenId: token.tokenId,
    clientRef,
  }).lean()
  // Expired by the TTL monitor between the insert and this read: try the insert once more.
  if (!existing)
    return attempt === 0
      ? claim(token, tool, clientRef, argsHash, argsPreview, 1)
      : { kind: 'busy' }

  const age = now.getTime() - existing.at.getTime()
  const stale =
    existing.outcome === 'pending'
      ? age > ABANDONED_CLAIM_MS
      : age > REPLAY_WINDOW_MS

  if (!stale) {
    if (existing.tool !== tool || existing.argsHash !== argsHash)
      return { kind: 'mismatch' }
    if (existing.outcome === 'ok')
      return { kind: 'replay', text: existing.resultPreview ?? '' }
    if (existing.outcome === 'pending') return { kind: 'busy' }
  }

  // Take the row over: refused, error, or outside its window. Conditional on the exact row
  // we read, so a second retry racing for it loses and is told the first is running.
  const taken = await AgentActionModel.findOneAndUpdate(
    { _id: existing._id, outcome: existing.outcome, at: existing.at },
    {
      $set: {
        tool,
        outcome: 'pending',
        reason: null,
        target: null,
        argsHash,
        argsPreview,
        tokenName: token.name,
        at: now,
        expireAt: agentActionExpiryFrom(now),
      },
      $unset: { resultPreview: 1 },
    },
    { returnDocument: 'after', lean: true }
  )
  if (!taken) return { kind: 'busy' }

  // Keep the earlier call's row in the feed, without the key (see the header).
  const {
    _id: _oldId,
    clientRef: _oldRef,
    resultPreview: _oldResult,
    ...history
  } = existing
  // A pending row being replaced is a call that never finished (a killed function): kept as
  // an error, so the feed does not show it in flight for the next 180 days.
  await AgentActionModel.create(
    existing.outcome === 'pending'
      ? { ...history, outcome: 'error', reason: 'abandoned' }
      : history
  ).catch((error: unknown) =>
    console.error('[mcp] could not keep the replaced audit row', error)
  )
  return { kind: 'claimed', rowId: String(taken._id), at: now }
}

/**
 * Close a claimed row. Retried, because a row left `pending` is taken over as abandoned ten
 * minutes later and the call runs AGAIN - the duplicate R4 exists to prevent. Conditional on
 * the claim this call made (`pending` at its own `at`), so a call whose row was already taken
 * over cannot overwrite the newer attempt's outcome.
 */
async function finalize(
  tool: string,
  claimed: { rowId: string; at: Date },
  row: AuditRow,
  text: string
) {
  for (let attempt = 0; attempt < FINALIZE_ATTEMPTS; attempt += 1)
    try {
      const saved = await AgentActionModel.updateOne(
        { _id: claimed.rowId, outcome: 'pending', at: claimed.at },
        {
          $set: {
            outcome: row.outcome,
            reason: row.reason,
            target: row.target,
            ...(row.outcome === 'ok' ? { resultPreview: text } : {}),
          },
        }
      )
      if (saved.matchedCount === 0)
        console.warn(
          `[mcp] ${tool} claim ${claimed.rowId} was taken over before it finished; its outcome (${row.outcome}) is not recorded on it`
        )
      return
    } catch (error) {
      if (attempt === FINALIZE_ATTEMPTS - 1) {
        console.error(
          `[mcp] could not finalize ${tool} claim ${claimed.rowId} (outcome ${row.outcome}, target ${JSON.stringify(row.target)}); a retry after 10 min will run it again`,
          error
        )
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100 * 4 ** attempt))
    }
}

const FINALIZE_ATTEMPTS = 3

// MARK: runTool

function toCallResult(result: ToolResult) {
  return {
    content: [{ type: 'text' as const, text: result.text }],
    ...(result.outcome === 'ok' ? {} : { isError: true }),
  }
}

export async function runTool(
  def: AnyToolDefinition,
  rawArgs: unknown,
  token: AgentContext
) {
  let target: AgentActionTarget | null = null
  let result: ToolResult | null = null
  let claimed: { rowId: string; at: Date } | null = null
  const argsPreview = def.audited ? previewArgs(rawArgs) : ''

  try {
    // 1 The filter decided what was listed; this decides what runs.
    if (!hasAnyScope(def.scopes, token)) {
      result = refuse(
        `${def.name} is not allowed for this token: it needs the ${def.scopes.join(' or ')} scope. Nothing was changed.`,
        'scope'
      )
      return toCallResult(result)
    }

    // 2
    const parsed = def.input.safeParse(rawArgs ?? {})
    if (!parsed.success) {
      result = refuse(describeIssues(def.name, parsed.error), 'invalid')
      return toCallResult(result)
    }
    const args = parsed.data as Record<string, unknown>

    // 3
    const clientRef =
      def.keyed && typeof args.clientRef === 'string' ? args.clientRef : null
    if (clientRef) {
      const outcome = await claim(
        token,
        def.name,
        clientRef,
        hashArgs(args),
        argsPreview
      )
      if (outcome.kind === 'replay') {
        result = { text: outcome.text, outcome: 'ok', reason: 'replay' }
        return toCallResult(result)
      }
      if (outcome.kind === 'busy') {
        result = refuse(
          `A call with clientRef "${clientRef}" is still running. Retry shortly with the same clientRef to get its result.`,
          'in-flight'
        )
        return toCallResult(result)
      }
      if (outcome.kind === 'mismatch') {
        result = refuse(
          `clientRef "${clientRef}" was already used with different arguments in the last 24 hours. Use a new clientRef for a different call.`,
          'invalid'
        )
        return toCallResult(result)
      }
      claimed = { rowId: outcome.rowId, at: outcome.at }
    }

    // 4
    let spent = false
    const spend = async (): Promise<ToolResult | null> => {
      if (spent) return null
      spent = true
      for (const limit of def.cost?.(args) ?? []) {
        const bucket = await checkRateLimit(`mcp-token:${token.tokenId}`, limit)
        if (!bucket.ok)
          return refuse(
            `Rate limit: this token has used its ${limit.route} budget (${limit.limit} per ${Math.round(limit.windowSeconds / 60)} min). Try again in ${bucket.retryAfterSeconds} s. Nothing was changed.`,
            'rate'
          )
      }
      return null
    }
    if (!def.lazyCost) {
      const refused = await spend()
      if (refused) {
        result = refused
        return toCallResult(result)
      }
    }

    // 5
    result = await def.run(args, {
      token,
      setTarget: next => {
        target = next
      },
      spend,
    })

    // 6
    result = { ...result, text: clipToBudget(result.text, def.name) }
    return toCallResult(result)
  } catch (error) {
    console.error(`[mcp] ${def.name} threw`, error)
    result = {
      text: `${def.name} failed unexpectedly. Retry once; if it fails again, tell the owner - the server log has the details.`,
      outcome: 'error',
      reason: 'exception',
    }
    return toCallResult(result)
  } finally {
    // 7
    if (def.audited && result) {
      const row: AuditRow = {
        tool: def.name,
        outcome: result.outcome,
        reason: result.reason ?? null,
        target,
        argsPreview,
      }
      if (claimed) await finalize(def.name, claimed, row, result.text)
      else recordLater(token, row)
    }
  }
}
