'use client'

import {
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Hourglass,
  KeyRound,
  Pencil,
  Plug,
  RotateCw,
  ShieldX,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import Spinner from '@/components/settings/Spinner'
import {
  helpTextCls,
  inputCls,
  itemCardCls,
  labelCls,
  primaryBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import {
  DEFAULT_SCOPES,
  MCP_SCOPES,
  MCP_TOKEN_ENV,
  SCOPE_INFO,
  type ClientAgentAction,
  type McpScope,
} from '@/lib/mcp/scopes'
import { cn } from '@/lib/utils'
import {
  createAgentTokenApi,
  deleteAgentTokenApi,
  getAgentsApi,
  revokeAgentTokenApi,
  updateAgentTokenScopesApi,
  type AgentsSnapshot,
} from '@/requests/agents'

/**
 * `/admin/agents`: create, list, re-scope, revoke and delete scoped `p4_` tokens, revoke and
 * delete legacy `wbt_` ones, connect Claude Code or Codex, and read what agents did.
 *
 * ```
 *   Create (name + scope checkboxes: read, write on; publish, pii off)
 *     ──▶ p4_... shown ONCE (Copy, "won't be shown again")
 *     1 export PORT4LIO_MCP_TOKEN=p4_...          in the shell profile, not typed inline
 *     2 claude mcp add --scope user ... 'Authorization: Bearer ${PORT4LIO_MCP_TOKEN}'
 *       (Codex tab: bearer_token_env_var)
 *   while the fresh token has lastUsedAt null: GET every 5 s ──▶ "Connected - first call just now"
 *   Scopes ──▶ the same checkboxes inline ──▶ Save ──▶ applies from the token's next call
 *   Revoke ──▶ Revoke now ──▶ row greyed out, 401 from the next call
 *   revoked row: Delete ──▶ Delete permanently ──▶ row gone (Activity keeps its name)
 *   Legacy whiteboard tokens: revoke, then delete (they die with the alias, mcp-plan.md T11)
 *   Activity: the last 50 AgentAction rows - writes, refusals, find_order lookups
 * ```
 *
 * ## Why the header is single-quoted
 *
 * Claude Code expands `${VAR}` in stored headers, so the single-quoted form stores the
 * reference in `~/.claude.json` and the token itself stays in the shell profile. Double
 * quotes would let the shell expand it first and write the plaintext token into the config.
 *
 * ## Why user scope, in words on the page
 *
 * Project scope writes `.mcp.json` into the repo, which gets committed. That is the one
 * mistake here that publishes access to the whole site.
 *
 * ## Why publish and pii start unticked
 *
 * `publish` changes what the public sees and `pii` reads a customer's order. Both are one
 * deliberate click away rather than on by default, so the everyday token - the one most
 * likely to sit in a laptop's shell profile - cannot do either (mcp.md "Scopes").
 *
 * ## Why delete only appears on a revoked row
 *
 * Revoke is the step that kills a key, and it has its own confirm. Delete only tidies the
 * list afterwards, so it is never offered for a live token and the server refuses one with a
 * 409 anyway - one click can never skip the revoke.
 */

function ago(iso: string | null) {
  if (!iso) return 'never used'
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'used just now'
  if (minutes < 60) return `used ~${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `used ~${hours} h ago`
  return `used ~${Math.round(hours / 24)} days ago`
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          // The text is selectable in place; nothing else to do.
        }
      }}
      className="shrink-0 rounded-lg p-1.5 text-pp-muted hover:bg-pp-text/5 hover:text-pp-text"
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

function Code({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-1 rounded-xl border border-pp-line bg-pp-text/[0.04] p-2">
      <pre className="min-w-0 flex-1 select-all whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed text-pp-text">
        {text}
      </pre>
      <CopyButton
        text={text}
        label={label}
      />
    </div>
  )
}

function ConnectSteps({ token }: { token: string }) {
  const [tab, setTab] = useState<'claude' | 'codex'>('claude')
  const mcpUrl = `${window.location.origin}/api/mcp`
  const claudeCommand = `claude mcp add --scope user --transport http port4lio ${mcpUrl} \\\n  --header 'Authorization: Bearer \${${MCP_TOKEN_ENV}}'`
  const codexCommand = `codex mcp add port4lio --url ${mcpUrl} --bearer-token-env-var ${MCP_TOKEN_ENV}`
  const codexToml = `[mcp_servers.port4lio]\nurl = "${mcpUrl}"\nbearer_token_env_var = "${MCP_TOKEN_ENV}"`

  return (
    <ol className="space-y-3 text-[13px] text-pp-text">
      <li>
        <p className="mb-1">
          <b>1.</b> Put it in your shell profile (~/.zshrc), not typed inline:
        </p>
        <Code
          text={`export ${MCP_TOKEN_ENV}=${token}`}
          label="Copy export line"
        />
      </li>
      <li>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p>
            <b>2.</b> Add the server
          </p>
          <div
            role="tablist"
            aria-label="Agent"
            className="flex rounded-full border border-pp-line p-0.5 text-[11px]"
          >
            {(['claude', 'codex'] as const).map(value => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-full px-2.5 py-0.5 font-semibold',
                  tab === value ? 'bg-pp-text text-white' : 'text-pp-muted'
                )}
              >
                {value === 'claude' ? 'Claude Code' : 'Codex'}
              </button>
            ))}
          </div>
        </div>
        {tab === 'claude' ? (
          <>
            <Code
              text={claudeCommand}
              label="Copy claude mcp add command"
            />
            <p className={cn(helpTextCls, 'mt-1.5')}>
              User scope, never project scope: project scope writes .mcp.json,
              which gets committed. The single quotes store the $
              {`{${MCP_TOKEN_ENV}}`} reference in ~/.claude.json, not the token.
            </p>
          </>
        ) : (
          <>
            <Code
              text={codexCommand}
              label="Copy codex mcp add command"
            />
            <p className={cn(helpTextCls, 'my-1.5')}>
              or in ~/.codex/config.toml:
            </p>
            <Code
              text={codexToml}
              label="Copy Codex config"
            />
          </>
        )}
      </li>
      <li>
        <b>3.</b> Now ask {tab === 'claude' ? 'Claude' : 'Codex'}:{' '}
        <i>Load who I am.</i>
      </li>
    </ol>
  )
}

function ScopeChecks({
  value,
  onToggle,
}: {
  value: McpScope[]
  onToggle: (scope: McpScope) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {MCP_SCOPES.map(scope => (
        <label
          key={scope}
          className="flex cursor-pointer items-start gap-3 rounded-2xl border border-pp-line bg-white/70 p-3"
        >
          <input
            type="checkbox"
            checked={value.includes(scope)}
            onChange={() => onToggle(scope)}
            className="mt-0.5 h-4 w-4 accent-pp-text"
          />
          <span>
            <span className="block text-sm font-semibold text-pp-text">
              {SCOPE_INFO[scope].label}{' '}
              <span className="font-mono text-[11px] font-normal text-pp-muted">
                {scope}
              </span>
            </span>
            <span className={helpTextCls}>{SCOPE_INFO[scope].grants}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

function toggled(list: McpScope[], scope: McpScope) {
  return list.includes(scope)
    ? list.filter(entry => entry !== scope)
    : [...list, scope]
}

const sameScopes = (a: McpScope[], b: McpScope[]) =>
  a.length === b.length && a.every(scope => b.includes(scope))

const OUTCOME_ICON: Record<ClientAgentAction['outcome'], typeof CircleCheck> = {
  ok: CircleCheck,
  refused: ShieldX,
  error: CircleAlert,
  pending: Hourglass,
}

const OUTCOME_TINT: Record<ClientAgentAction['outcome'], string> = {
  ok: 'text-pp-ink-green',
  refused: 'text-pp-ink-rose',
  error: 'text-pp-ink-rose',
  pending: 'text-pp-muted',
}

interface Props {
  className?: string
}

export default function AgentsBoard({ className }: Props) {
  const [data, setData] = useState<AgentsSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<McpScope[]>([...DEFAULT_SCOPES])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ token: string; id: string } | null>(null)
  // One pending confirm at a time, so "Revoke now" and "Delete permanently" never both show.
  const [confirm, setConfirm] = useState<{
    id: string
    action: 'revoke' | 'delete'
  } | null>(null)
  // Revoke is how a leaked credential dies, so a failed one says so - never a silent reset.
  const [rowError, setRowError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{
    id: string
    scopes: McpScope[]
  } | null>(null)
  const [savingScopes, setSavingScopes] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setData(await getAgentsApi())
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Could not load tokens'
      )
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const freshRecord = fresh
    ? data?.tokens.find(token => token.id === fresh.id)
    : undefined
  const connected = Boolean(freshRecord?.lastUsedAt)

  // While a just-created token has never been used, check every 5 s. Stops when it flips
  // to Connected or the page unmounts.
  useEffect(() => {
    if (!fresh || connected) return
    const timer = setInterval(() => void refresh(), 5_000)
    return () => clearInterval(timer)
  }, [connected, fresh, refresh])

  const toggleScope = (scope: McpScope) =>
    setScopes(prev => toggled(prev, scope))

  const create = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const { token, record } = await createAgentTokenApi(
        name.trim() || 'Agent',
        scopes
      )
      setFresh({ token, id: record.id })
      setData(prev =>
        prev ? { ...prev, tokens: [record, ...prev.tokens] } : prev
      )
      setName('')
      setScopes([...DEFAULT_SCOPES])
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : 'Could not create a token'
      )
    } finally {
      setCreating(false)
    }
  }

  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : ''

  const revoke = async (id: string) => {
    setRowError(null)
    try {
      await revokeAgentTokenApi(id)
      if (fresh?.id === id) setFresh(null)
      if (editing?.id === id) setEditing(null)
    } catch (error) {
      setRowError(
        `Could not revoke - the token still works. ${errorText(error)}`.trim()
      )
    } finally {
      setConfirm(null)
      await refresh()
    }
  }

  const remove = async (id: string) => {
    setRowError(null)
    try {
      await deleteAgentTokenApi(id)
    } catch (error) {
      setRowError(`Could not delete the token. ${errorText(error)}`.trim())
    } finally {
      setConfirm(null)
      await refresh()
    }
  }

  const saveScopes = async () => {
    if (!editing) return
    setSavingScopes(true)
    setRowError(null)
    try {
      const { record } = await updateAgentTokenScopesApi(
        editing.id,
        editing.scopes
      )
      setData(prev =>
        prev
          ? {
              ...prev,
              tokens: prev.tokens.map(token =>
                token.id === record.id ? record : token
              ),
            }
          : prev
      )
      setEditing(null)
    } catch (error) {
      setRowError(
        `Could not change the scopes - the old ones still apply. ${errorText(error)}`.trim()
      )
      await refresh()
    } finally {
      setSavingScopes(false)
    }
  }

  const confirmButton = (
    id: string,
    label: string,
    action: 'revoke' | 'delete'
  ) => {
    const verb = action === 'revoke' ? 'Revoke' : 'Delete'
    return confirm?.id === id && confirm.action === action ? (
      <button
        type="button"
        onClick={() => void (action === 'revoke' ? revoke(id) : remove(id))}
        className="shrink-0 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700"
      >
        {action === 'revoke' ? 'Revoke now' : 'Delete permanently'}
      </button>
    ) : (
      <button
        type="button"
        aria-label={`${verb} ${label}`}
        onClick={() => setConfirm({ id, action })}
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-pp-muted hover:text-pp-ink-rose"
      >
        {action === 'delete' ? <Trash2 size={12} /> : null}
        {verb}
      </button>
    )
  }

  return (
    <div className={cn('space-y-8', className)}>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
          Owner
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-pp-text sm:text-4xl">
          Agents
        </h1>
        <p className="mt-3 max-w-[62ch] text-base leading-relaxed text-pp-muted">
          Tokens for Claude Code and Codex to work on this site over MCP. Each
          token sees only the tools its scopes allow, and every write it makes
          lands in the activity list below.
        </p>
      </header>

      <section
        aria-labelledby="agents-create"
        className={itemCardCls}
      >
        <h2
          id="agents-create"
          className="font-display text-lg font-semibold text-pp-text"
        >
          New token
        </h2>
        <form
          data-testid="agents-create-form"
          className="mt-4 space-y-4"
          onSubmit={event => {
            event.preventDefault()
            void create()
          }}
        >
          <div>
            <label
              htmlFor="agent-token-name"
              className={labelCls}
            >
              Name
            </label>
            <input
              id="agent-token-name"
              placeholder="e.g. Laptop - Claude Code"
              value={name}
              maxLength={80}
              onChange={event =>
                setName(event.target.value.replace(/[\r\n]+/g, ' '))
              }
              className={inputCls}
            />
          </div>
          <fieldset>
            <legend className={labelCls}>Scopes</legend>
            <ScopeChecks
              value={scopes}
              onToggle={toggleScope}
            />
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={creating || scopes.length === 0}
              className={primaryBtnCls}
            >
              {creating ? <Spinner size={14} /> : 'Create token'}
            </button>
            {scopes.length === 0 ? (
              <p className={helpTextCls}>Pick at least one scope.</p>
            ) : null}
            {createError ? (
              <p className="text-[12px] text-pp-ink-rose">{createError}</p>
            ) : null}
          </div>
        </form>

        {fresh ? (
          <div
            data-testid="agents-fresh-token"
            className="mt-5 space-y-3 rounded-2xl border border-pp-line bg-white/80 p-4"
          >
            {connected ? (
              <p
                data-testid="agents-connected"
                className="flex items-center gap-2 text-[13px] font-semibold text-pp-ink-green"
              >
                <Plug size={14} /> Connected - first call just now
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-pp-muted">
                <Spinner size={12} /> Waiting for the first call...
              </p>
            )}
            <div>
              <p className={labelCls}>
                Your token - it won&apos;t be shown again
              </p>
              <Code
                text={fresh.token}
                label="Copy token"
              />
            </div>
            <ConnectSteps token={fresh.token} />
          </div>
        ) : null}
      </section>

      {rowError ? (
        <p
          role="alert"
          data-testid="agents-row-error"
          className="flex items-center gap-2 text-[12px] font-semibold text-pp-ink-rose"
        >
          <TriangleAlert size={14} /> {rowError}
        </p>
      ) : null}
      {loadError && !data ? (
        <div className="flex items-center gap-2 text-[13px] text-pp-ink-rose">
          <TriangleAlert size={14} /> {loadError}
          <button
            type="button"
            onClick={() => void refresh()}
            className={cn(secondaryBtnCls, 'ml-auto gap-1.5 px-3 py-1')}
          >
            <RotateCw size={12} /> Retry
          </button>
        </div>
      ) : !data ? (
        <p className="flex items-center gap-2 text-[13px] text-pp-muted">
          <Spinner size={12} /> Loading tokens...
        </p>
      ) : (
        <>
          <section aria-labelledby="agents-tokens">
            <h2
              id="agents-tokens"
              className="font-display text-lg font-semibold text-pp-text"
            >
              Tokens
            </h2>
            {data.tokens.length === 0 ? (
              <p className={cn(helpTextCls, 'mt-2')}>
                No tokens yet. Create one above to connect an agent.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-pp-line border-y border-pp-line">
                {data.tokens.map(token => {
                  const edit = editing?.id === token.id ? editing : null
                  return (
                    <li
                      key={token.id}
                      data-testid="agent-token-row"
                      className="py-2.5 text-[13px]"
                    >
                      <div className="flex items-center gap-3">
                        <KeyRound
                          aria-hidden
                          size={14}
                          className="shrink-0 text-pp-muted"
                        />
                        <div
                          className={cn(
                            'min-w-0 flex-1',
                            token.revokedAt && 'opacity-50'
                          )}
                        >
                          <p className="truncate font-semibold text-pp-text">
                            {token.name}
                          </p>
                          <p className="text-[11.5px] text-pp-muted">
                            <span className="font-mono">{token.prefix}...</span>{' '}
                            · {token.scopes.join(', ')} ·{' '}
                            {token.revokedAt
                              ? 'revoked'
                              : ago(token.lastUsedAt)}
                          </p>
                        </div>
                        {token.revokedAt ? (
                          confirmButton(token.id, token.name, 'delete')
                        ) : (
                          <>
                            {edit ? null : (
                              <button
                                type="button"
                                aria-label={`Edit scopes of ${token.name}`}
                                onClick={() => {
                                  setConfirm(null)
                                  setEditing({
                                    id: token.id,
                                    scopes: [...token.scopes],
                                  })
                                }}
                                className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-pp-muted hover:text-pp-text"
                              >
                                <Pencil size={12} /> Scopes
                              </button>
                            )}
                            {confirmButton(token.id, token.name, 'revoke')}
                          </>
                        )}
                      </div>
                      {edit ? (
                        <form
                          data-testid="agent-scope-editor"
                          aria-label={`Scopes of ${token.name}`}
                          className="mt-3 space-y-3 pl-[26px]"
                          onSubmit={event => {
                            event.preventDefault()
                            void saveScopes()
                          }}
                        >
                          <ScopeChecks
                            value={edit.scopes}
                            onToggle={scope =>
                              setEditing({
                                ...edit,
                                scopes: toggled(edit.scopes, scope),
                              })
                            }
                          />
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="submit"
                              disabled={
                                savingScopes ||
                                edit.scopes.length === 0 ||
                                sameScopes(edit.scopes, token.scopes)
                              }
                              className={primaryBtnCls}
                            >
                              {savingScopes ? (
                                <Spinner size={14} />
                              ) : (
                                'Save scopes'
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className={secondaryBtnCls}
                            >
                              Cancel
                            </button>
                            <p className={helpTextCls}>
                              {edit.scopes.length === 0
                                ? 'Pick at least one scope.'
                                : "Applies from the token's next call. The token itself stays the same."}
                            </p>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {data.legacy.length > 0 ? (
            <section aria-labelledby="agents-legacy">
              <h2
                id="agents-legacy"
                className="font-display text-lg font-semibold text-pp-text"
              >
                Legacy whiteboard tokens
              </h2>
              <p className={cn(helpTextCls, 'mt-1 max-w-[62ch]')}>
                Read-only wbt_ tokens from the whiteboard. They work only on
                /api/whiteboard/mcp and context.md, and stop working when that
                alias is removed. Revoke them once your agents use a token from
                this page.
              </p>
              <ul className="mt-3 divide-y divide-pp-line border-y border-pp-line">
                {data.legacy.map(token => (
                  <li
                    key={token.id}
                    data-testid="legacy-token-row"
                    className="flex items-center gap-3 py-2.5 text-[13px]"
                  >
                    <div
                      className={cn(
                        'min-w-0 flex-1',
                        token.revokedAt && 'opacity-50'
                      )}
                    >
                      <p className="truncate font-semibold text-pp-text">
                        {token.name}
                      </p>
                      <p className="text-[11.5px] text-pp-muted">
                        <span className="font-mono">{token.prefix}...</span> ·{' '}
                        {token.revokedAt ? 'revoked' : ago(token.lastUsedAt)}
                      </p>
                    </div>
                    {confirmButton(
                      token.id,
                      token.name,
                      token.revokedAt ? 'delete' : 'revoke'
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="agents-activity">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="agents-activity"
                className="font-display text-lg font-semibold text-pp-text"
              >
                Activity
              </h2>
              <button
                type="button"
                onClick={() => void refresh()}
                className={cn(secondaryBtnCls, 'gap-1.5 px-3 py-1')}
              >
                <RotateCw size={12} /> Refresh
              </button>
            </div>
            <p className={cn(helpTextCls, 'mt-1')}>
              Every write, refusal and order lookup an agent made, newest first.
              Kept for 180 days.
            </p>
            {data.actions.length === 0 ? (
              <p className={cn(helpTextCls, 'mt-3')}>No agent activity yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-pp-line border-y border-pp-line">
                {data.actions.map(action => {
                  const Icon = OUTCOME_ICON[action.outcome]
                  return (
                    <li
                      key={action.id}
                      data-testid="agent-action-row"
                      className="flex items-start gap-3 py-2.5 text-[13px]"
                    >
                      <Icon
                        aria-label={action.outcome}
                        size={15}
                        className={cn(
                          'mt-0.5 shrink-0',
                          OUTCOME_TINT[action.outcome]
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-pp-text">
                          <span className="font-mono font-semibold">
                            {action.tool}
                          </span>{' '}
                          <span className="text-pp-muted">
                            by {action.tokenName}
                          </span>
                          {action.target ? (
                            <span className="text-pp-muted">
                              {' '}
                              on {action.target.slug ?? action.target.id}
                            </span>
                          ) : null}
                        </p>
                        <p className="break-all font-mono text-[11px] text-pp-muted">
                          {action.outcome}
                          {action.reason ? ` (${action.reason})` : ''} ·{' '}
                          {action.argsPreview}
                        </p>
                      </div>
                      <time
                        dateTime={action.at}
                        className="shrink-0 text-[11.5px] text-pp-muted"
                      >
                        {when(action.at)}
                      </time>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
