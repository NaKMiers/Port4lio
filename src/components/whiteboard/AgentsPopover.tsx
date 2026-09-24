'use client'

import {
  Check,
  Copy,
  KeyRound,
  Plug,
  RotateCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import Spinner from '@/components/settings/Spinner'
import {
  inputCls,
  labelCls,
  primaryBtnCls,
  secondaryBtnCls,
} from '@/components/settings/settings-utils'
import { cn } from '@/lib/utils'
import type { ClientToken } from '@/lib/whiteboard/types'
import {
  createTokenApi,
  deleteTokenForeverApi,
  getTokensApi,
  revokeTokenApi,
} from '@/requests/whiteboard'

/**
 * Agents: create, list and revoke the read-only MCP tokens, and connect an agent (DR5).
 *
 * ```
 *   Create ──▶ wbt_... shown ONCE (Copy, "won't be shown again")
 *     1 export PORT4LIO_WB_TOKEN=wbt_...          in the shell profile, not typed inline
 *     2 claude mcp add --scope user ... 'Authorization: Bearer ${PORT4LIO_WB_TOKEN}'
 *       (Codex tab: bearer_token_env_var)
 *     3 "Now ask Claude: What are my active goals?"
 *   while open and the new token has lastUsedAt null: GET /tokens every 5 s
 *     └ first MCP call writes lastUsedAt (D29) ──▶ "Connected - first call just now"
 *   Revoke ──▶ Revoke now ──▶ row greyed out, 401 from the next call
 *     └ Delete forever ──▶ Delete now ──▶ record gone (revoked only; 409 otherwise)
 * ```
 *
 * ## Why the header is single-quoted
 *
 * Claude Code expands `${VAR}` in stored headers, so the single-quoted form stores the
 * reference in `~/.claude.json` and the token itself stays in the shell profile. Double
 * quotes would let the shell expand it first and write the plaintext token into the config.
 *
 * ## Why user scope, in words on the panel
 *
 * Project scope writes `.mcp.json` into the repo, which gets committed. That is the one
 * mistake here that publishes access to the most private data on the site.
 */

const ENV = 'PORT4LIO_WB_TOKEN'

function ago(iso: string | null) {
  if (!iso) return 'never used'
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'used just now'
  if (minutes < 60) return `used ~${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `used ~${hours} h ago`
  return `used ~${Math.round(hours / 24)} days ago`
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
      <pre className="min-w-0 flex-1 select-all whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-pp-text">
        {text}
      </pre>
      <CopyButton
        text={text}
        label={label}
      />
    </div>
  )
}

export function AgentsButton({
  open,
  onToggle,
  className,
}: {
  open: boolean
  onToggle: (open: boolean) => void
  className?: string
}) {
  const [tokens, setTokens] = useState<ClientToken[] | null>(null)
  const [failed, setFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      setTokens(await getTokensApi())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    // Once for the count on the button, then again on every open: a token used by an agent
    // while the popover was closed must not still read "never used" when it reopens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as HTMLElement))
        onToggle(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onToggle, open])

  const active = tokens?.filter(t => !t.revokedAt).length ?? 0

  return (
    <div
      ref={rootRef}
      // Below md the popover anchors to the header (TopBar), not to this button: on a phone the
      // button sits mid-row, and a panel hung off its right edge ran past the left of the screen.
      className={cn('md:relative', className)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Agents, ${active} active token${active === 1 ? '' : 's'}`}
        onClick={() => onToggle(!open)}
        className="inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-pp-line bg-white/85 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-pp-text sm:px-3.5"
      >
        <KeyRound
          aria-hidden
          size={14}
        />
        <span className="hidden xl:inline">Agents</span>
        <span className="text-pp-muted">{active}</span>
      </button>
      {open ? (
        <AgentsPanel
          tokens={tokens}
          failed={failed}
          refresh={refresh}
          setTokens={setTokens}
        />
      ) : null}
    </div>
  )
}

function AgentsPanel({
  tokens,
  failed,
  refresh,
  setTokens,
}: {
  tokens: ClientToken[] | null
  failed: boolean
  refresh: () => Promise<void>
  setTokens: (
    update: (prev: ClientToken[] | null) => ClientToken[] | null
  ) => void
}) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ token: string; id: string } | null>(null)
  const [tab, setTab] = useState<'claude' | 'codex'>('claude')
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => headingRef.current?.focus(), [])

  const freshRecord = fresh ? tokens?.find(t => t.id === fresh.id) : undefined
  const connected = Boolean(freshRecord?.lastUsedAt)

  // DR5: while a just-created token has never been used, check every 5 s. Stops when this
  // panel unmounts (the popover closed) or the row flips to Connected.
  useEffect(() => {
    if (!fresh || connected) return
    const timer = setInterval(() => void refresh(), 5_000)
    return () => clearInterval(timer)
  }, [connected, fresh, refresh])

  const create = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const { token, record } = await createTokenApi(name.trim() || 'Agent')
      setFresh({ token, id: record.id })
      setTokens(prev => [record, ...(prev ?? [])])
      setName('')
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : 'Could not create a token'
      )
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    try {
      const record = await revokeTokenApi(id)
      setTokens(prev => prev?.map(t => (t.id === id ? record : t)) ?? prev)
      if (fresh?.id === id) setFresh(null)
    } catch {
      await refresh()
    } finally {
      setConfirmRevoke(null)
    }
  }

  /**
   * Revoked tokens only (the server refuses an active one). Two clicks like Revoke, because
   * the record is the only trace of which machine a key was on - once it is gone, "which
   * laptop was that?" has no answer. A failure re-reads the list rather than guessing.
   */
  const removeForever = async (id: string) => {
    try {
      await deleteTokenForeverApi(id)
      setTokens(prev => prev?.filter(t => t.id !== id) ?? prev)
    } catch {
      await refresh()
    } finally {
      setConfirmDelete(null)
    }
  }

  const mcpUrl = `${window.location.origin}/api/whiteboard/mcp`
  const claudeCommand = `claude mcp add --scope user --transport http me ${mcpUrl} \\\n  --header 'Authorization: Bearer \${${ENV}}'`
  const codexCommand = `codex mcp add me --url ${mcpUrl} --bearer-token-env-var ${ENV}`
  const codexToml = `[mcp_servers.me]\nurl = "${mcpUrl}"\nbearer_token_env_var = "${ENV}"`

  return (
    <div
      role="dialog"
      aria-labelledby="wb-agents-title"
      data-testid="wb-agents-popover"
      className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-[calc(100dvh-110px)] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-[1.4rem] border border-pp-line bg-pp-panel-strong p-4 text-left shadow-panel max-md:left-2 max-md:right-2 max-md:max-h-[calc(100dvh-140px)] max-md:w-auto"
    >
      <h2
        id="wb-agents-title"
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-base font-semibold text-pp-text outline-none"
      >
        Agents
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-pp-muted">
        Read-only tokens for Claude Code and Codex. They see only what the AI
        export sees - never hidden frames or cards.
      </p>

      {fresh ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-pp-line bg-white/80 p-3">
          {connected ? (
            <p
              data-testid="wb-agents-connected"
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
          <ol className="space-y-2.5 text-[12.5px] text-pp-text">
            <li>
              <p className="mb-1">
                <b>1.</b> Put it in your shell profile (~/.zshrc), not typed
                inline:
              </p>
              <Code
                text={`export ${ENV}=${fresh.token}`}
                label="Copy export line"
              />
            </li>
            <li>
              <div className="mb-1 flex items-center justify-between">
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
                        tab === value
                          ? 'bg-pp-text text-white'
                          : 'text-pp-muted'
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
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-pp-muted">
                    User scope, never project scope: project scope writes
                    .mcp.json, which gets committed. The single quotes store the
                    ${`{${ENV}}`} reference in ~/.claude.json, not the token.
                  </p>
                </>
              ) : (
                <>
                  <Code
                    text={codexCommand}
                    label="Copy codex mcp add command"
                  />
                  <p className="my-1.5 text-[11.5px] text-pp-muted">
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
              <i>What are my active goals?</i>
            </li>
          </ol>
        </div>
      ) : null}

      <form
        className="mt-4 flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          void create()
        }}
      >
        <input
          aria-label="Token name"
          placeholder="Name, e.g. Laptop - Claude Code"
          value={name}
          maxLength={80}
          onChange={event =>
            setName(event.target.value.replace(/[\r\n]+/g, ' '))
          }
          className={cn(inputCls, 'py-2.5')}
        />
        <button
          type="submit"
          disabled={creating}
          className={cn(primaryBtnCls, 'shrink-0 px-4 py-2.5')}
        >
          {creating ? <Spinner size={14} /> : 'Create token'}
        </button>
      </form>
      {createError ? (
        <p className="mt-1.5 text-[12px] text-pp-ink-rose">{createError}</p>
      ) : null}

      <div className="mt-4">
        {tokens === null && !failed ? (
          <p className="flex items-center gap-2 text-[12px] text-pp-muted">
            <Spinner size={12} /> Loading tokens...
          </p>
        ) : failed && tokens === null ? (
          <div className="flex items-center gap-2 text-[12px] text-pp-ink-rose">
            <TriangleAlert size={13} /> Couldn&apos;t load tokens
            <button
              type="button"
              onClick={() => void refresh()}
              className={cn(secondaryBtnCls, 'ml-auto gap-1.5 px-3 py-1')}
            >
              <RotateCw size={12} /> Retry
            </button>
          </div>
        ) : tokens && tokens.length === 0 ? (
          <p className="text-[12px] text-pp-muted">
            No tokens yet. Create one to connect an agent.
          </p>
        ) : (
          <ul className="divide-y divide-pp-line border-y border-pp-line">
            {tokens?.map(token => (
              <li
                key={token.id}
                data-testid="wb-token-row"
                className="flex items-center gap-2 py-2 text-[12.5px]"
              >
                {/* Faded text, not a faded row: the Delete forever button must stay legible. */}
                <div
                  className={cn(
                    'min-w-0 flex-1',
                    token.revokedAt && 'opacity-50'
                  )}
                >
                  <p className="truncate font-semibold text-pp-text">
                    {token.name}
                  </p>
                  <p className="text-[11px] text-pp-muted">
                    <span className="font-mono">{token.prefix}...</span> ·{' '}
                    {token.revokedAt ? 'revoked' : ago(token.lastUsedAt)}
                  </p>
                </div>
                {token.revokedAt ? (
                  confirmDelete === token.id ? (
                    <button
                      type="button"
                      onClick={() => void removeForever(token.id)}
                      className="shrink-0 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700"
                    >
                      Delete now
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(token.id)}
                      aria-label={`Delete ${token.name} forever`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-pp-muted hover:text-pp-ink-rose"
                    >
                      <Trash2
                        aria-hidden
                        size={12}
                      />
                      Delete forever
                    </button>
                  )
                ) : confirmRevoke === token.id ? (
                  <button
                    type="button"
                    onClick={() => void revoke(token.id)}
                    className="rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700"
                  >
                    Revoke now
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(token.id)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-pp-muted hover:text-pp-ink-rose"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
