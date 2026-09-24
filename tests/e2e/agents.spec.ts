import { expect, test, type APIRequestContext } from '@playwright/test'

import { STORAGE_STATE } from './global-setup'

/**
 * `/admin/agents` in a real browser, against a production build (mcp-plan.md T3).
 *
 * ```
 *   create (read + write ticked, publish + pii not) ──▶ p4_ shown ──▶ first MCP call ──▶ Connected
 *   reload ──▶ the plaintext is off the page, the row stays; its Copy puts the same token on
 *              the clipboard (sealed copy, token-vault.ts)
 *   revoke ──▶ row greyed, the next agent call is a 401 ──▶ Delete permanently ──▶ row gone
 *   Scopes ──▶ tick write ──▶ Save ──▶ the same token lists create_draft on its next call
 *   legacy wbt_ ──▶ listed under "Legacy whiteboard tokens", revoke, then delete
 *   an out-of-scope call ──▶ a refused row in Activity (R1)
 * ```
 *
 * Runs only against a disposable database (global-setup refuses anything else).
 */
test.use({ storageState: STORAGE_STATE })
test.describe.configure({ mode: 'serial' })

const MCP_HEADERS = { accept: 'application/json, text/event-stream' }

async function agentCall(
  agent: APIRequestContext,
  path: string,
  token: string,
  body: unknown
) {
  return agent.post(path, {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
    data: body,
  })
}

test('(1) a new token, read and write on by default, flips to Connected and can be copied again', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  await page.goto('/admin/agents')
  const form = page.getByTestId('agents-create-form')
  await expect(form.getByRole('checkbox', { name: /Read/ })).toBeChecked()
  await expect(form.getByRole('checkbox', { name: /Write/ })).toBeChecked()
  await expect(
    form.getByRole('checkbox', { name: /Publish/ })
  ).not.toBeChecked()
  await expect(
    form.getByRole('checkbox', { name: /Order lookup/ })
  ).not.toBeChecked()

  const name = `e2e agent ${Date.now()}`
  await form.getByRole('textbox', { name: 'Name' }).fill(name)
  await form.getByRole('button', { name: 'Create token' }).click()

  const fresh = page.getByTestId('agents-fresh-token')
  await expect(fresh).toContainText('you can copy it again any time')
  await expect(fresh).toContainText(
    "--header 'Authorization: Bearer ${PORT4LIO_MCP_TOKEN}'"
  )
  await expect(fresh).toContainText('/api/mcp')
  const token = (await fresh.locator('pre').first().textContent())?.trim() ?? ''
  expect(token).toMatch(/^p4_[A-Za-z0-9_-]{43}$/)

  // An agent, with the token and nothing else - no owner cookie.
  const agent = await playwright.request.newContext({ baseURL })
  const res = await agentCall(agent, '/api/mcp', token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  })
  expect(res.status()).toBe(200)
  const tools = ((await res.json()).result.tools as { name: string }[]).map(
    tool => tool.name
  )
  expect(tools).toContain('get_profile')
  expect(tools).not.toContain('publish_post')
  await agent.dispose()

  await expect(fresh.getByTestId('agents-connected')).toHaveText(
    /Connected - first call just now/,
    { timeout: 15_000 }
  )

  // Reload: the plaintext is off the page, the row stays.
  await page.reload()
  await expect(page.getByTestId('agents-fresh-token')).toHaveCount(0)
  await expect(page.getByText(token)).toHaveCount(0)
  const row = page.getByTestId('agent-token-row').filter({ hasText: name })
  await expect(row).toContainText('read, write')

  // ...and its Copy puts the very same token on the clipboard, whenever it is clicked.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await row.getByRole('button', { name: `Copy token ${name}` }).click()
  await expect(
    row.getByRole('button', { name: `Copy token ${name}` })
  ).toContainText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token)
  // Still off the page: the token went to the clipboard, not into the DOM.
  await expect(page.getByText(token)).toHaveCount(0)
})

test('(2) revoking a token greys it out and the next agent call is a 401', async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  const name = `e2e revoke ${Date.now()}`
  const created = await request.post('/api/admin/agents/tokens', {
    data: { name, scopes: ['read'] },
  })
  expect(created.ok()).toBe(true)
  const { token } = await created.json()

  await page.goto('/admin/agents')
  const row = page.getByTestId('agent-token-row').filter({ hasText: name })
  await row.getByRole('button', { name: `Revoke ${name}` }).click()
  await row.getByRole('button', { name: 'Revoke now' }).click()
  await expect(row).toContainText('revoked')
  // A revoked token has nothing left to copy.
  await expect(
    row.getByRole('button', { name: `Copy token ${name}` })
  ).toHaveCount(0)

  const agent = await playwright.request.newContext({ baseURL })
  const res = await agentCall(agent, '/api/mcp', token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'ping',
  })
  expect(res.status()).toBe(401)
  await agent.dispose()

  await row.getByRole('button', { name: `Delete ${name}` }).click()
  await row.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(row).toHaveCount(0)
})

test("(2b) changing a token's scopes applies to the same token on its next call", async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  const name = `e2e rescope ${Date.now()}`
  const created = await request.post('/api/admin/agents/tokens', {
    data: { name, scopes: ['read'] },
  })
  expect(created.ok()).toBe(true)
  const { token } = await created.json()

  const agent = await playwright.request.newContext({ baseURL })
  const tools = async () => {
    const res = await agentCall(agent, '/api/mcp', token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
    const body = await res.json()
    return (body.result.tools as { name: string }[]).map(tool => tool.name)
  }
  expect(await tools()).not.toContain('create_draft')

  await page.goto('/admin/agents')
  const row = page.getByTestId('agent-token-row').filter({ hasText: name })
  await row.getByRole('button', { name: `Edit scopes of ${name}` }).click()
  const editor = row.getByTestId('agent-scope-editor')
  await editor.getByRole('checkbox', { name: /Write/ }).check()
  await editor.getByRole('button', { name: 'Save scopes' }).click()
  await expect(editor).toHaveCount(0)
  await expect(row).toContainText('read, write')

  expect(await tools()).toContain('create_draft')
  await agent.dispose()
})

test('(3) legacy wbt_ tokens are listed and can be revoked, and never open /api/mcp', async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  const name = `e2e legacy ${Date.now()}`
  const created = await request.post('/api/admin/whiteboard/tokens', {
    data: { name },
  })
  expect(created.ok()).toBe(true)
  const { token } = await created.json()

  const agent = await playwright.request.newContext({ baseURL })
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
  expect((await agentCall(agent, '/api/mcp', token, ping)).status()).toBe(401)
  expect(
    (await agentCall(agent, '/api/whiteboard/mcp', token, ping)).status()
  ).toBe(200)

  await page.goto('/admin/agents')
  const row = page.getByTestId('legacy-token-row').filter({ hasText: name })
  await row.getByRole('button', { name: `Revoke ${name}` }).click()
  await row.getByRole('button', { name: 'Revoke now' }).click()
  await expect(row).toContainText('revoked')

  expect(
    (await agentCall(agent, '/api/whiteboard/mcp', token, ping)).status()
  ).toBe(401)
  await agent.dispose()

  await row.getByRole('button', { name: `Delete ${name}` }).click()
  await row.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(row).toHaveCount(0)
})

test('(4) a call outside the token lands in Activity as refused (R1)', async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  const name = `e2e blind ${Date.now()}`
  const { token } = await (
    await request.post('/api/admin/agents/tokens', {
      data: { name, scopes: ['write'] },
    })
  ).json()

  const agent = await playwright.request.newContext({ baseURL })
  const res = await agentCall(agent, '/api/mcp', token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_profile', arguments: { section: 'identity' } },
  })
  expect(res.status()).toBe(200)
  expect((await res.json()).result.isError).toBe(true)
  await agent.dispose()

  await page.goto('/admin/agents')
  const action = page
    .getByTestId('agent-action-row')
    .filter({ hasText: name })
    .first()
  await expect(action).toContainText('get_profile')
  await expect(action).toContainText('refused (scope)')
})
