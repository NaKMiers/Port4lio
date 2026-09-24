import 'server-only'

import type {
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server'
import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'

import {
  hasAnyScope,
  recordScopeRefusal,
  runTool,
  type AnyToolDefinition,
} from '@/lib/mcp/run-tool'
import { LEGACY_SCOPE, type TokenScope } from '@/lib/mcp/scopes'
import type { AgentContext } from '@/lib/mcp/token'
import { BLOG_TOOLS } from '@/lib/mcp/tools/blog'
import { CCAF_TOOLS } from '@/lib/mcp/tools/ccaf'
import { CLOUDINARY_TOOLS } from '@/lib/mcp/tools/cloudinary'
import {
  getMeTool,
  getProfileTool,
  updateProfileTool,
} from '@/lib/mcp/tools/me'
import { METRICS_TOOLS } from '@/lib/mcp/tools/metrics'
import { PROMPTS } from '@/lib/mcp/tools/prompts'
import {
  ALIAS_WHITEBOARD_NAMES,
  SITE_WHITEBOARD_NAMES,
  whiteboardReadTools,
  whiteboardWriteTools,
} from '@/lib/mcp/tools/whiteboard'
import {
  agentJson,
  noStore,
  sseToJson,
  withAcceptBoth,
} from '@/lib/mcp/transport'

/**
 * The MCP servers: which tools and prompts exist, and which ones a given token sees.
 *
 * ```
 *   module load (once per lambda)
 *     compile(REGISTRY): zod ──▶ JSON Schema, frozen          never per request (perf, R2-19)
 *
 *   per request, after guardAgent verified { tokenId, name, scopes }
 *     body is a JSON-RPC batch (an array)? ──▶ 400 -32600, never reaches the SDK
 *     body is a tools/call for a registry tool this token lacks?
 *        └─ yes ──▶ isError naming the missing scope + ONE refused AgentAction row   (R1)
 *     createMcpHandler(server => {                    mcp-handler builds a fresh McpServer anyway
 *        for tool of spec.tools   if any scope matches ──▶ registerTool(.., args => runTool(def, args, token))
 *        for prompt of spec.prompts if any scope matches ──▶ registerPrompt(.., rendered for this tool list)
 *     })(withAcceptBoth(request)) ──▶ sseToJson ──▶ no-store
 * ```
 *
 * ## Why a closure per request and no handler cache (C1)
 *
 * mcp-handler already constructs a new `McpServer` for every HTTP request (`index.mjs`
 * 195-198); the whiteboard server registered its three tools on every request before this
 * file existed. So the token is verified first and the initializer simply closes over it.
 * There is no `Map<scopes, handler>` to invalidate and no `withMcpAuth`. What IS worth
 * caching is the zod-to-JSON-Schema conversion, and that happens once, below, at load.
 *
 * ## Why the listed tools are filtered AND `runTool` checks again
 *
 * The filter keeps a read-only token's tool list short and honest - it cannot even see that
 * `publish_post` exists - which keeps tool choice accurate. It is not the gate. A registry
 * bug that lists the wrong tool is still refused by `runTool` step 1.
 *
 * ## Why out-of-scope calls are answered here (R1)
 *
 * An unregistered tool never reaches `runTool`: the SDK answers "Tool X not found" and no
 * audit row is written, so a leaked read token probing for write tools would leave no trace.
 * The route therefore peeks at the JSON-RPC body first. A name that exists in the registry
 * but not for this token gets an `isError` naming the scope, plus a `refused` row. A name
 * that exists nowhere still gets the SDK's own error, and no row.
 *
 * ## Why the SDK is handed a schema that accepts anything
 *
 * `tools/list` needs the real JSON Schema, and it gets it. But if the SDK also validated, a
 * bad call would be refused before our code ran: no `refused(invalid)` row, and a message
 * written for a developer. So validation happens in `runTool`, which teaches the fix.
 */

// MARK: Compiled definitions

export interface CompiledTool {
  def: AnyToolDefinition
  schema: StandardSchemaWithJSON
}

export interface PromptDefinition {
  name: string
  title: string
  description: string
  scopes: readonly TokenScope[]
  /** Prompt arguments are strings on the wire (MCP). */
  args: z.ZodObject<Record<string, z.ZodType<string | undefined>>>
  /** Rendered per request, so "if X is in your tool list" is true for THIS token (C6). */
  render(
    args: Record<string, string | undefined>,
    tools: ReadonlySet<string>
  ): string
}

interface CompiledPrompt {
  def: PromptDefinition
  schema: StandardSchemaWithJSON
}

/** Advertise `json`, validate nothing: `runTool` does the real parse (see the header). */
function passthrough(json: Record<string, unknown>): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'port4lio',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  } as StandardSchemaWithJSON
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  }) as Record<string, unknown>
  return { type: 'object', ...json }
}

export function compileTools(defs: readonly AnyToolDefinition[]) {
  const names = new Set<string>()
  return Object.freeze(
    defs.map(def => {
      if (names.has(def.name)) throw new Error(`Duplicate MCP tool ${def.name}`)
      names.add(def.name)
      return { def, schema: passthrough(toJsonSchema(def.input)) }
    })
  )
}

export function compilePrompts(defs: readonly PromptDefinition[]) {
  return Object.freeze(
    defs.map(def => ({ def, schema: passthrough(toJsonSchema(def.args)) }))
  )
}

// MARK: Server specs

export interface ServerSpec {
  name: string
  version: string
  tools: readonly CompiledTool[]
  prompts: readonly CompiledPrompt[]
  instructions(tools: ReadonlySet<string>): string
}

/**
 * The site-wide registry: the design's 27 less the four the Assignment cut (delete_post,
 * save_taxonomy, get_test_metrics, whiteboard_update_item - acceptance.md D1), plus the four
 * Cloudinary asset tools added after the Assignment (`tools/cloudinary.ts`).
 */
export const SITE_SERVER: ServerSpec = {
  name: 'port4lio',
  version: '2.0.0',
  tools: compileTools([
    getMeTool,
    getProfileTool,
    updateProfileTool,
    ...BLOG_TOOLS,
    ...METRICS_TOOLS,
    ...CCAF_TOOLS,
    ...CLOUDINARY_TOOLS,
    ...whiteboardReadTools(SITE_WHITEBOARD_NAMES, ['read']),
    ...whiteboardWriteTools(),
  ]),
  prompts: compilePrompts(PROMPTS),
  instructions: tools =>
    [
      "The owner's own site, Port4lio: portfolio profile and CV, blog, metrics, a private whiteboard and a certificate study tracker.",
      'Your tool list is exactly what this token allows; a tool you do not see is not available to you.',
      'Errors come back as tool results that say how to fix the call.',
      tools.has('get_me') ? 'For "who am I", call get_me first.' : '',
      tools.has('create_draft')
        ? 'To write a post, read get_writing_brief (or use the write-post prompt) and follow its loop; drafts never publish themselves.'
        : '',
      tools.has('whiteboard_overview')
        ? 'For the whiteboard, start with whiteboard_overview, then whiteboard_search, then whiteboard_get_item. Cite item ids.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
}

/** `/api/whiteboard/mcp`, for one release: the old names, `read` OR the legacy scope (C5). */
export const WHITEBOARD_ALIAS_SERVER: ServerSpec = {
  name: 'port4lio-whiteboard',
  version: '1.0.0',
  tools: compileTools(
    whiteboardReadTools(ALIAS_WHITEBOARD_NAMES, ['read', LEGACY_SCOPE])
  ),
  prompts: compilePrompts([]),
  instructions: () =>
    "The owner's private whiteboards: dreams, goals, failures, drafts and notes, linked with labelled arrows. They may keep several boards and share only some of them; you see the shared ones. Read-only. Start with get_overview, then search_context, then get_item for detail. Cite item ids.",
}

// MARK: Per-request registration

/** The tool names this token can see on this server. */
export function visibleToolNames(
  spec: ServerSpec,
  token: Pick<AgentContext, 'scopes'>
) {
  return new Set(
    spec.tools
      .filter(({ def }) => hasAnyScope(def.scopes, token))
      .map(({ def }) => def.name)
  )
}

export function registerFor(
  server: McpServer,
  token: AgentContext,
  spec: ServerSpec
) {
  const visible = visibleToolNames(spec, token)

  for (const { def, schema } of spec.tools) {
    if (!visible.has(def.name)) continue
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: schema,
        annotations: def.annotations,
      },
      (args: unknown) => runTool(def, args, token)
    )
  }

  for (const { def, schema } of spec.prompts) {
    if (!hasAnyScope(def.scopes, token)) continue
    server.registerPrompt(
      def.name,
      { title: def.title, description: def.description, argsSchema: schema },
      (args: unknown) => {
        const parsed = def.args.safeParse(args ?? {})
        const values = parsed.success
          ? (parsed.data as Record<string, string | undefined>)
          : {}
        return {
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: def.render(values, visible),
              },
            },
          ],
        }
      }
    )
  }
}

// MARK: R1 and the request

type RpcCall = { id: string | number; name: string; arguments: unknown }

/**
 * What the body needs before the SDK sees it: a batch (refused outright), a single `tools/call`
 * naming a registry tool this token lacks (refused and audited, R1), or nothing.
 */
async function preflight(
  request: Request,
  spec: ServerSpec,
  token: AgentContext
): Promise<{ kind: 'batch' } | { kind: 'refused'; call: RpcCall } | null> {
  // Lowercased: the SDK matches the media type case-insensitively, so `Application/JSON`
  // would otherwise skip this peek and still be served, leaving no refused row.
  if (
    !(request.headers.get('content-type') ?? '')
      .toLowerCase()
      .includes('application/json')
  )
    return null
  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return null
  }
  /*
    A JSON-RPC batch. The SDK's legacy path would serve up to 100 calls from one array, which
    let an out-of-scope call skip the R1 audit below (this peek reads one object) and charged
    the front-door rate limit once for 100 calls. MCP 2025-06-18 dropped batching and no
    client this server supports sends one, so it is refused before the SDK sees it.
  */
  if (Array.isArray(body)) return { kind: 'batch' }
  if (!body || typeof body !== 'object') return null
  const message = body as {
    method?: unknown
    id?: unknown
    params?: { name?: unknown; arguments?: unknown }
  }
  if (message.method !== 'tools/call') return null
  if (typeof message.id !== 'string' && typeof message.id !== 'number')
    return null
  const name = message.params?.name
  if (typeof name !== 'string') return null

  const tool = spec.tools.find(({ def }) => def.name === name)
  if (!tool || hasAnyScope(tool.def.scopes, token)) return null
  return {
    kind: 'refused',
    call: { id: message.id, name, arguments: message.params?.arguments },
  }
}

export async function handleMcpRequest(
  request: Request,
  token: AgentContext,
  spec: ServerSpec
): Promise<Response> {
  const checked = await preflight(request, spec, token)
  if (checked?.kind === 'batch')
    return agentJson(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32600,
          message:
            'Invalid Request: batching is not supported. Send one JSON-RPC message per request.',
        },
      },
      { status: 400 }
    )
  if (checked?.kind === 'refused') {
    const refused = checked.call
    const def = spec.tools.find(({ def }) => def.name === refused.name)!.def
    recordScopeRefusal(token, refused.name, refused.arguments)
    return agentJson({
      jsonrpc: '2.0',
      id: refused.id,
      result: {
        content: [
          {
            type: 'text',
            text: `${refused.name} is not allowed for this token: it needs the ${def.scopes.filter(scope => scope !== LEGACY_SCOPE).join(' or ')} scope. Nothing was changed. The owner can create a token with that scope in /admin/agents.`,
          },
        ],
        isError: true,
      },
    })
  }

  const visible = visibleToolNames(spec, token)
  const handler = createMcpHandler(server => registerFor(server, token, spec), {
    serverInfo: { name: spec.name, version: spec.version },
    instructions: spec.instructions(visible),
  })
  return noStore(await sseToJson(await handler(withAcceptBoth(request))))
}
