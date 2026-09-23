import { readFile } from 'node:fs/promises'

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { STORAGE_STATE } from './global-setup'

/**
 * The whiteboard's risky flows in a real browser, against a production build (D26 + DR4/DR5).
 *
 * Unit and API tests prove each piece alone - the serializer, the save queue, the routes, the
 * privacy filter. These prove the wiring: that a card drawn in the page is the card that
 * reloads, that a restore really brings a deleted frame back, that a hidden card really stays
 * out of what the owner copies, and that a broken load never becomes an editable board.
 *
 * Runs only against a disposable database (global-setup refuses anything else), and starts
 * each test from an empty board by deleting every item through the API.
 */
test.use({ storageState: STORAGE_STATE })
test.describe.configure({ mode: 'serial' })

const API = '/api/admin/whiteboard'

function objectId() {
  const hex = (n: number, len: number) => n.toString(16).padStart(len, '0')
  return (
    hex(Math.floor(Date.now() / 1000), 8) +
    Array.from({ length: 16 }, () =>
      hex(Math.floor(Math.random() * 16), 1)
    ).join('')
  )
}

async function clearBoard(request: APIRequestContext) {
  const res = await request.get(API)
  expect(res.ok()).toBe(true)
  const ids = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(line => line.t === 'item')
    .map(line => line.item._id as string)
  for (const id of ids) await request.delete(`${API}/items/${id}`)
}

async function boardLines(request: APIRequestContext) {
  const text = await (await request.get(API)).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

async function openBoard(page: Page) {
  await page.goto('/admin/whiteboard')
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/, {
    timeout: 30_000,
  })
}

test.beforeEach(async ({ request }) => {
  await clearBoard(request)
})

test('(1) a card drawn in the page survives autosave and a reload', async ({
  page,
}) => {
  await openBoard(page)
  await expect(page.getByText('Put down one true thing.')).toBeVisible()

  await page.getByRole('button', { name: 'Text card T', exact: true }).click()
  const title = page.getByRole('textbox', { name: 'Title' }).first()
  await expect(title).toBeFocused()
  await page.keyboard.type('A card that must survive')
  await page.keyboard.press('Escape')

  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  await page.reload()
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/, {
    timeout: 30_000,
  })
  await expect(page.getByText('A card that must survive')).toBeVisible()
})

test('(2) delete a frame, then restore from backup: frame, children and links come back', async ({
  page,
  request,
}, testInfo) => {
  const frame = objectId()
  const child = objectId()
  const other = objectId()
  const link = objectId()
  await request.post(`${API}/items`, {
    data: {
      _id: frame,
      form: 'frame',
      title: 'Restore me',
      x: 0,
      y: 0,
      width: 520,
      height: 360,
    },
  })
  await request.post(`${API}/items`, {
    data: {
      _id: child,
      form: 'text',
      title: 'Child card',
      parentId: frame,
      x: 40,
      y: 60,
    },
  })
  await request.post(`${API}/items`, {
    data: { _id: other, form: 'text', title: 'Outside card', x: 700, y: 60 },
  })
  await request.post(`${API}/links`, {
    data: { _id: link, from: child, to: other, label: 'because' },
  })

  await openBoard(page)

  // Download the backup.
  await page.getByRole('button', { name: 'Backup' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download backup (JSON)' }).click(),
  ])
  const backupPath = testInfo.outputPath('backup.json')
  await download.saveAs(backupPath)
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  expect(backup.version).toBe(1)
  expect(backup.items).toHaveLength(3)

  // Delete the frame (and the child with it, to lose everything).
  await page.getByText('Restore me').click()
  await page.getByText('Child card').click({ modifiers: ['Control'] })
  await page.keyboard.press('Delete')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Delete 2 items and 1 link?')
  await dialog.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(page.getByText('Restore me')).toHaveCount(0)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  expect(
    (await boardLines(request)).filter(l => l.t === 'item').map(l => l.item._id)
  ).toEqual([other])

  // Restore it.
  await page.getByRole('button', { name: 'Backup' }).click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: 'Restore from backup' }).click(),
  ])
  await chooser.setFiles(backupPath)
  const restore = page.getByRole('alertdialog')
  await expect(restore).toContainText('3 items, 1 links, 1 already exist')
  await restore.getByRole('button', { name: 'Restore' }).click()
  await expect(restore).toContainText('documents written')
  await restore.getByRole('button', { name: 'Close' }).click()

  await expect(page.getByText('Restore me')).toBeVisible()
  await expect(page.getByText('Child card')).toBeVisible()
  const lines = await boardLines(request)
  expect(lines.filter(l => l.t === 'item')).toHaveLength(3)
  expect(lines.filter(l => l.t === 'link').map(l => l.link._id)).toEqual([link])
  expect(
    lines.find(l => l.t === 'item' && l.item._id === child).item.parentId
  ).toBe(frame)
})

test('(3) a hidden card is left out of the export, and the sheet says so (D25)', async ({
  page,
  request,
}) => {
  await request.post(`${API}/items`, {
    data: {
      _id: objectId(),
      form: 'text',
      title: 'Visible goal',
      meaning: 'goal',
      x: 0,
      y: 0,
    },
  })
  await request.post(`${API}/items`, {
    data: {
      _id: objectId(),
      form: 'text',
      title: 'Secret card',
      includeInAi: false,
      x: 320,
      y: 0,
    },
  })

  await openBoard(page)
  await page.getByText('Visible goal').click()
  await page.getByText('Secret card').click({ modifiers: ['Control'] })
  await page.getByRole('button', { name: 'Export selection' }).click()

  const sheet = page.getByTestId('wb-export-sheet')
  await expect(sheet.getByTestId('wb-export-notice')).toHaveText(
    /1 selected item is hidden and not included/
  )
  const preview = sheet.getByTestId('wb-export-preview')
  await expect(preview).toContainText('Visible goal')
  await expect(preview).not.toContainText('Secret card')
  await expect(sheet.getByRole('button', { name: 'Copy' })).toBeEnabled()
})

test('(4) a failed load shows Retry, and nothing can be written', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', req => {
    if (req.url().includes(API) && req.method() !== 'GET')
      writes.push(`${req.method()} ${req.url()}`)
  })
  // A stream that stops before its `end` line: a partial board, which must be an error.
  await page.route(`**${API}`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: '{"t":"start","items":5,"links":0}\n',
    })
  )

  await page.goto('/admin/whiteboard')
  await expect(page.getByText("Couldn't load the board.")).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Text card, T' })
  ).toBeDisabled()

  await page.keyboard.press('t')
  await page.mouse.click(500, 500)
  await page.waitForTimeout(1000)
  expect(writes).toEqual([])
})

test('(5) Esc peels one layer at a time: tool, then sheet, then selection', async ({
  page,
  request,
}) => {
  await request.post(`${API}/items`, {
    data: { _id: objectId(), form: 'text', title: 'Esc target', x: 0, y: 0 },
  })
  await openBoard(page)

  await page.getByText('Esc target').click()
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Esc target'
  )
  await page.keyboard.press('Control+e')
  await expect(page.getByTestId('wb-export-sheet')).toBeVisible()
  await page.getByRole('button', { name: 'Pen, P' }).click()
  await expect(page.getByRole('button', { name: 'Pen, P' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Select, V' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByTestId('wb-export-sheet')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wb-export-sheet')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByText('Nothing selected')).toBeVisible()
})

test('(6) the Agents panel flips to Connected after the first MCP call (DR5)', async ({
  page,
  playwright,
  baseURL,
}) => {
  await openBoard(page)
  await page.getByRole('button', { name: /^Agents/ }).click()
  const panel = page.getByTestId('wb-agents-popover')
  await panel.getByLabel('Token name').fill(`e2e ${Date.now()}`)
  await panel.getByRole('button', { name: 'Create token' }).click()
  await expect(panel).toContainText("won't be shown again")
  await expect(panel).toContainText(
    "--header 'Authorization: Bearer ${PORT4LIO_WB_TOKEN}'"
  )

  const token = (await panel.locator('pre').first().textContent())?.trim() ?? ''
  expect(token).toMatch(/^wbt_/)

  // An agent, with the token and nothing else - no owner cookie.
  const agent = await playwright.request.newContext({ baseURL })
  const res = await agent.post('/api/whiteboard/mcp', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  })
  expect(res.status()).toBe(200)
  await agent.dispose()

  await expect(panel.getByTestId('wb-agents-connected')).toHaveText(
    /Connected - first call just now/,
    { timeout: 15_000 }
  )
})
