import { readFile } from 'node:fs/promises'

import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
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
/**
 * The board every test works on (D32). Taken from the boards API in `beforeEach`, which is
 * also what creates the first board, so the suite never assumes one exists.
 */
let BOARD = ''
/** Item and link calls name their board, exactly as the canvas does. */
const on = (path: string) => `${API}${path}?board=${BOARD}`

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
  const res = await request.get(on(''))
  expect(res.ok()).toBe(true)
  const ids = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(line => line.t === 'item')
    .map(line => line.item._id as string)
  for (const id of ids) await request.delete(on(`/items/${id}`))
}

async function boardLines(request: APIRequestContext) {
  const text = await (await request.get(on(''))).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

async function openBoard(page: Page) {
  await page.goto(`/admin/whiteboard/${BOARD}`)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/, {
    timeout: 30_000,
  })
}

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/boards`)
  expect(res.ok()).toBe(true)
  const { boards } = await res.json()
  BOARD = boards[0]._id
  await clearBoard(request)
})

test('(1) a card drawn in the page survives autosave and a reload', async ({
  page,
}) => {
  await openBoard(page)
  await expect(page.getByText('Put down one true thing.')).toBeVisible()
  // Hidden on purpose (proOptions.hideAttribution in Canvas.tsx).
  await expect(page.locator('.react-flow__attribution')).toHaveCount(0)

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
  await request.post(on('/items'), {
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
  await request.post(on('/items'), {
    data: {
      _id: child,
      form: 'text',
      title: 'Child card',
      parentId: frame,
      x: 40,
      y: 60,
    },
  })
  await request.post(on('/items'), {
    data: { _id: other, form: 'text', title: 'Outside card', x: 700, y: 60 },
  })
  await request.post(on('/links'), {
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
  await expect(page.getByTestId('wb-notice')).toContainText(
    '2 items and 1 link deleted'
  )
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
  await request.post(on('/items'), {
    data: {
      _id: objectId(),
      form: 'text',
      title: 'Visible goal',
      meaning: 'goal',
      x: 0,
      y: 0,
    },
  })
  await request.post(on('/items'), {
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

  // The preview is the markdown rendered for reading, not its source...
  await expect(
    preview.getByRole('heading', { name: 'Visible goal' })
  ).toBeVisible()
  await expect(preview).not.toContainText('####')

  // ...and Copy still hands over the markdown.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await sheet.getByRole('button', { name: 'Copy' }).click()
  await expect(sheet.getByRole('button', { name: /Copied/ })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('#### Visible goal')
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
  await page.route(`**${API}?*`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: '{"t":"start","items":5,"links":0}\n',
    })
  )

  await page.goto(`/admin/whiteboard/${BOARD}`)
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
  await request.post(on('/items'), {
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

test('(6) the board has no Agents button: MCP tokens live on /admin/agents', async ({
  page,
}) => {
  // Token creation moved from this board's popover to /admin/agents when the MCP became
  // site-wide (docs/designs/mcp/mcp.md premise 7), and the link that replaced it left the top
  // bar too - the admin hub reaches that page. The token flow it used to cover is
  // tests/e2e/agents.spec.ts (1), against p4_ tokens.
  await openBoard(page)
  await expect(page.getByRole('button', { name: 'Export to AI' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Agents/ })).toHaveCount(0)
})

test('(7) a card deleted and brought back by a restore can be edited again', async ({
  page,
  request,
}, testInfo) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Round trip', x: 0, y: 0 },
  })
  await openBoard(page)

  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download backup (JSON)' }).click(),
  ])
  const backupPath = testInfo.outputPath('backup.json')
  await download.saveAs(backupPath)

  await page.getByText('Round trip').click()
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)

  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: 'Restore from backup' }).click(),
  ])
  await chooser.setFiles(backupPath)
  const restore = page.getByRole('alertdialog')
  await restore.getByRole('button', { name: 'Restore' }).click()
  await expect(restore).toContainText('documents written')
  await restore.getByRole('button', { name: 'Close' }).click()

  // Same session, same id: this edit used to be dropped without a word.
  await page.getByText('Round trip').click()
  const title = page.getByRole('textbox', { name: 'Title' })
  await title.fill('Round trip, edited')
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  await expect
    .poll(async () => {
      const lines = await boardLines(request)
      return lines.find(l => l.t === 'item' && l.item._id === card)?.item.title
    })
    .toBe('Round trip, edited')
})

test('(8) keyboard: Tab selects a card, Esc in a field keeps it, a dialog blocks the canvas', async ({
  page,
  request,
}) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Keyboard card', x: 0, y: 0 },
  })
  await openBoard(page)

  // Tab onto the card: it becomes the selection (DR9), so the inspector shows it.
  const node = page.locator(`.react-flow__node[data-id="${card}"]`)
  for (let i = 0; i < 60; i++) {
    if (await node.evaluate(el => el === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(node).toBeFocused()
  const title = page.getByRole('textbox', { name: 'Title' })
  await expect(title).toHaveValue('Keyboard card')

  // Esc in the title leaves the field; the card stays selected.
  await title.click()
  await page.keyboard.press('Escape')
  await expect(title).not.toBeFocused()
  await expect(title).toHaveValue('Keyboard card')

  // With a dialog open, arrows must not move the card behind it.
  await node.focus()
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(1_200) // past the nudge debounce
  const lines = await boardLines(request)
  expect(lines.find(l => l.t === 'item' && l.item._id === card)?.item.x).toBe(0)
})

test('(9) Delete takes the card at once, and Undo puts it back (D30)', async ({
  page,
  request,
}) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Second thoughts', x: 0, y: 0 },
  })
  await openBoard(page)

  await page.getByText('Second thoughts').click()
  await page.keyboard.press('Delete')
  // No confirm: it is already gone, on the canvas and on the server.
  await expect(page.getByText('Second thoughts')).toHaveCount(0)
  await expect(page.getByTestId('wb-notice')).toContainText('1 item deleted')
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  expect((await boardLines(request)).filter(l => l.t === 'item')).toHaveLength(
    0
  )

  await page
    .getByTestId('wb-notice')
    .getByRole('button', { name: 'Undo' })
    .click()
  await expect(page.getByText('Second thoughts')).toBeVisible()
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  const back = (await boardLines(request)).filter(l => l.t === 'item')
  expect(back).toHaveLength(1)
  expect(back[0].item.title).toBe('Second thoughts')
  // R3-6: the old id is spent for the session, so the copy carries a new one.
  expect(back[0].item._id).not.toBe(card)

  // And redo takes it away again.
  await page.keyboard.press('ControlOrMeta+Shift+KeyZ')
  await expect(page.getByText('Second thoughts')).toHaveCount(0)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  expect((await boardLines(request)).filter(l => l.t === 'item')).toHaveLength(
    0
  )
})

test('(10) auto-save off holds every write until Save, and leaving asks first (D31)', async ({
  page,
  request,
}) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Held card', x: 0, y: 0 },
  })
  await openBoard(page)

  // The switch defaults to on; turning it off is what makes the Save button appear.
  const autoSave = page.getByRole('switch', { name: 'Auto-save' })
  await expect(autoSave).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('wb-save-now')).toHaveCount(0)
  await autoSave.click()
  await expect(page.getByTestId('wb-save-now')).toBeDisabled()

  await page.getByText('Held card').click()
  await page.getByRole('textbox', { name: 'Title' }).fill('Edited, not saved')
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/1 unsaved/)

  // Past the debounce that would have saved it: with auto-save off, nothing goes out.
  await page.waitForTimeout(1_500)
  let items = (await boardLines(request)).filter(l => l.t === 'item')
  expect(items[0].item.title).toBe('Held card')

  // Leaving now asks, and Cancel keeps the board (and the edit) where it is.
  await page.getByRole('link', { name: 'All boards' }).click()
  const leave = page.getByRole('alertdialog')
  await expect(leave).toContainText('Leave with unsaved changes?')
  await leave.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/1 unsaved/)

  await page.getByTestId('wb-save-now').click()
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  items = (await boardLines(request)).filter(l => l.t === 'item')
  expect(items[0].item.title).toBe('Edited, not saved')

  // Nothing is waiting any more, so the way out stops asking.
  await page.getByRole('link', { name: 'All boards' }).click()
  await expect(page).toHaveURL(/\/admin\/whiteboard$/)
})

test('(11) many boards: the index makes one, and nothing crosses between them (D32)', async ({
  page,
  request,
}) => {
  await request.post(on('/items'), {
    data: {
      _id: objectId(),
      form: 'text',
      title: 'On the first board',
      x: 0,
      y: 0,
    },
  })

  // The index lists what exists and makes a new board, staying put with its name selected;
  // clicking the card is what opens it.
  await page.goto('/admin/whiteboard')
  await expect(page.getByRole('heading', { name: 'Whiteboards' })).toBeVisible()
  await page.getByRole('button', { name: 'New board' }).click()
  await expect(page.getByTestId('wb-board-card')).toHaveCount(2)
  await expect(page).toHaveURL(/\/admin\/whiteboard$/)
  await page.keyboard.type('Second board')
  await page.keyboard.press('Enter')
  await page.getByRole('link', { name: 'Open Second board' }).click()
  await expect(page).toHaveURL(/\/admin\/whiteboard\/[0-9a-f]{24}$/)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/, {
    timeout: 30_000,
  })
  const second = page.url().split('/').pop()!
  expect(second).not.toBe(BOARD)

  // The switcher renames the board on screen and flips its agent switch, without the index.
  await page.getByTestId('wb-board-switcher').click()
  const name = page.getByTestId('wb-board-panel').getByLabel('Board name')
  await expect(name).toHaveValue('Second board')
  await name.fill('Renamed on the canvas')
  await name.press('Enter')
  await page.getByRole('switch', { name: 'Agents can read this board' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wb-board-switcher')).toHaveText(
    /Renamed on the canvas/
  )
  await expect
    .poll(async () => {
      const { boards } = await (await request.get(`${API}/boards`)).json()
      const mine = boards.find((b: { _id: string }) => b._id === second)
      return { title: mine?.title, includeInAi: mine?.includeInAi }
    })
    .toEqual({ title: 'Renamed on the canvas', includeInAi: false })

  // A fresh board is empty: the first board's card is not on it.
  await expect(page.getByText('On the first board')).toHaveCount(0)
  await expect(page.getByText('Put down one true thing.')).toBeVisible()

  // Sample data (D33) fills it, and lands on this board only.
  await page.getByTestId('wb-mock-empty').click()
  await expect(page.getByText('Ship the whiteboard')).toBeVisible()
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)

  const mine = await request.get(`${API}?board=${second}`)
  const seeded = (await mine.text())
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  expect(seeded.filter(l => l.t === 'item').length).toBeGreaterThan(5)
  expect(seeded.filter(l => l.t === 'link').length).toBeGreaterThan(0)
  // The first board still holds exactly what it held.
  expect(
    (await boardLines(request))
      .filter(l => l.t === 'item')
      .map(l => l.item.title)
  ).toEqual(['On the first board'])

  // The switcher moves between them, and undo takes the whole seed back.
  await page.keyboard.press('ControlOrMeta+KeyZ')
  await expect(page.getByText('Ship the whiteboard')).toHaveCount(0)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)

  await page.getByTestId('wb-board-switcher').click()
  await page
    .getByRole('menuitemradio', { name: /Whiteboard/ })
    .first()
    .click()
  await expect(page).toHaveURL(new RegExp(`/admin/whiteboard/${BOARD}$`))
  await expect(page.getByText('On the first board')).toBeVisible()

  // Clean up, so the next run starts from one board again.
  expect((await request.delete(`${API}/boards/${second}`)).ok()).toBe(true)
})

test('(12) the export preview is built in the browser: live, unsaved edits and the board switch included', async ({
  page,
  request,
}) => {
  // The preview used to be a POST /context per edit. Nothing may call the server for it now.
  const exportCalls: string[] = []
  page.on('request', req => {
    if (req.url().includes('/api/admin/whiteboard/context'))
      exportCalls.push(req.url())
  })

  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Before the edit', x: 0, y: 0 },
  })
  await openBoard(page)
  await page.getByRole('switch', { name: 'Auto-save' }).click()

  await page.getByText('Before the edit').click()
  await page
    .getByRole('textbox', { name: 'Title' })
    .fill('Typed, not saved yet')
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/1 unsaved/)

  // The sheet shows the canvas, not the database - and says the two differ.
  await page.getByRole('button', { name: 'Export to AI' }).click()
  const sheet = page.getByTestId('wb-export-sheet')
  const preview = sheet.getByTestId('wb-export-preview')
  await expect(preview).toContainText('Typed, not saved yet')
  await expect(sheet).toContainText('1 unsaved change is in this preview')
  const saved = (await boardLines(request)).filter(l => l.t === 'item')
  expect(saved[0].item.title).toBe('Before the edit')

  // Saving clears the notice; the text stays.
  await page.getByTestId('wb-save-now').click()
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  await expect(sheet).not.toContainText('unsaved change')
  await expect(preview).toContainText('Typed, not saved yet')

  // The board's own switch, flipped from the board menu, empties the sheet at once.
  try {
    await page.getByTestId('wb-board-switcher').click()
    await page
      .getByRole('switch', { name: 'Agents can read this board' })
      .click()
    await page.keyboard.press('Escape')
    await expect(sheet).toContainText('This board is hidden from agents')
    await expect(sheet.getByRole('button', { name: 'Copy' })).toBeDisabled()
  } finally {
    // Every other test assumes a readable board.
    await request.patch(`${API}/boards/${BOARD}`, {
      data: { includeInAi: true },
    })
  }

  expect(exportCalls).toEqual([])
})

test('(13) a legacy token can be deleted forever only once revoked', async ({
  request,
}) => {
  // The legacy wbt_ routes stay for one release (acceptance.md D4). Their UI moved to
  // /admin/agents, which revokes only, so this pins the route contract itself.
  const name = `e2e forever ${Date.now()}`
  const created = await request.post(`${API}/tokens`, { data: { name } })
  expect(created.ok()).toBe(true)
  const { record } = await created.json()

  // The server refuses to delete a live key: revoking is the one way it dies.
  const early = await request.delete(`${API}/tokens/${record.id}?forever=1`)
  expect(early.status()).toBe(409)

  expect((await request.delete(`${API}/tokens/${record.id}`)).ok()).toBe(true)
  expect(
    (await request.delete(`${API}/tokens/${record.id}?forever=1`)).status()
  ).toBe(200)
  const { tokens } = await (await request.get(`${API}/tokens`)).json()
  expect(tokens.some((t: { id: string }) => t.id === record.id)).toBe(false)
})

async function centreOf(locator: Locator) {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function itemOnServer(request: APIRequestContext, id: string) {
  return (await boardLines(request)).find(
    line => line.t === 'item' && line.item._id === id
  )?.item
}

test('(14) dragging a card moves it without selecting it; a click selects it', async ({
  page,
  request,
}) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Drag me', x: 0, y: 0 },
  })
  await openBoard(page)
  const inspector = page.getByRole('complementary')
  await expect(page.getByText('Nothing selected')).toBeVisible()

  const from = await centreOf(page.getByTestId('wb-card'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 160, from.y + 90, { steps: 12 })
  await page.mouse.up()

  // Moved and saved, and the inspector never switched to it.
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  await expect
    .poll(async () => (await itemOnServer(request, card))?.x)
    .not.toBe(0)
  await expect(page.getByText('Nothing selected')).toBeVisible()
  await expect(inspector.locator('#wb-title')).toHaveCount(0)

  await page.getByText('Drag me').click()
  await expect(inspector.locator('#wb-title')).toHaveValue('Drag me')
})

test('(19) a new card opens its own title editor, not the inspector', async ({
  page,
  request,
}) => {
  await request.post(on('/items'), {
    data: { _id: objectId(), form: 'text', title: 'Already here', x: 0, y: 0 },
  })
  await openBoard(page)
  await page.getByText('Already here').click()
  const inspector = page.getByRole('complementary')
  await expect(inspector.locator('#wb-title')).toHaveValue('Already here')

  await page.getByRole('button', { name: 'Text card, T' }).click()
  const pane = await centreOf(page.locator('.react-flow__pane'))
  await page.mouse.click(pane.x, pane.y + 200)
  // Typing goes into the new card on the canvas; the inspector let go of the old one.
  await expect(
    page.getByTestId('wb-card').getByRole('textbox', { name: 'Title' })
  ).toBeFocused()
  await expect(page.getByText('Nothing selected')).toBeVisible()
  await expect(inspector.locator('#wb-title')).toHaveCount(0)
})

test('(20) with auto-save off, undoing every change brings the pill back to Saved', async ({
  page,
  request,
}) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Keep me', x: 0, y: 0 },
  })
  await openBoard(page)
  await page.getByRole('switch', { name: 'Auto-save' }).click()
  const pill = page.getByTestId('wb-save-pill')

  // An edit, undone.
  await page.getByText('Keep me').click()
  await page
    .getByRole('complementary')
    .locator('#wb-title')
    .fill('Changed my mind')
  await expect(pill).toHaveText(/1 unsaved/)
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+KeyZ')
  await expect(page.getByTestId('wb-card')).toContainText('Keep me')
  await expect(pill).toHaveText(/Saved/)

  // A move, undone.
  const from = await centreOf(page.getByTestId('wb-card'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 120, from.y + 60, { steps: 10 })
  await page.mouse.up()
  await expect(pill).toHaveText(/1 unsaved/)
  await page.keyboard.press('ControlOrMeta+KeyZ')
  await expect(pill).toHaveText(/Saved/)

  // A delete, undone: the same card comes back, not a copy.
  await page.getByText('Keep me').click()
  await page.keyboard.press('Delete')
  await expect(pill).toHaveText(/1 unsaved/)
  await page.keyboard.press('ControlOrMeta+KeyZ')
  await expect(page.getByTestId('wb-card')).toHaveAttribute(
    'data-item-id',
    card
  )
  await expect(pill).toHaveText(/Saved/)

  // Nothing ever reached the server, and there is nothing to leave behind.
  const items = (await boardLines(request)).filter(l => l.t === 'item')
  expect(items).toHaveLength(1)
  expect(items[0].item).toMatchObject({
    _id: card,
    title: 'Keep me',
    x: 0,
    y: 0,
  })
  await page.getByRole('link', { name: 'All boards' }).click()
  await expect(page).toHaveURL(/\/admin\/whiteboard$/)
})

test('(21) holding Space, a drag that starts on a card pans the board and leaves the card', async ({
  page,
  request,
}) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Stay put', x: 0, y: 0 },
  })
  await openBoard(page)
  const viewport = page.locator('.react-flow__viewport')
  const before = await viewport.getAttribute('style')
  // Focus on the canvas, not a field: Space typed into a title is a space.
  await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })

  const from = await centreOf(page.getByTestId('wb-card'))
  await page.keyboard.down('Space')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 150, from.y + 80, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Space')

  await expect.poll(() => viewport.getAttribute('style')).not.toBe(before)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  expect((await itemOnServer(request, card))?.x).toBe(0)

  // Space up: the card drags again.
  const now = await centreOf(page.getByTestId('wb-card'))
  await page.mouse.move(now.x, now.y)
  await page.mouse.down()
  await page.mouse.move(now.x + 100, now.y, { steps: 10 })
  await page.mouse.up()
  await expect
    .poll(async () => (await itemOnServer(request, card))?.x)
    .not.toBe(0)
})

test('(22) Manage meanings: add one, give it to a card, and it cannot be deleted while used', async ({
  page,
  request,
}) => {
  const card = objectId()
  await request.post(on('/items'), {
    data: { _id: card, form: 'text', title: 'Needs a meaning', x: 0, y: 0 },
  })
  await openBoard(page)
  await page.getByText('Needs a meaning').click()
  await page.getByRole('button', { name: 'Manage meanings' }).click()

  const dialog = page.getByTestId('wb-vocab-dialog')
  await expect(dialog.getByRole('tab', { name: 'Meanings' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const label = `Idea ${Date.now() % 100000}`
  const key = `idea-${Date.now() % 100000}`
  // Every row starts collapsed: a chip and a count, no fields.
  await expect(dialog.getByTestId('wb-vocab-row')).toHaveCount(5)
  await expect(dialog.getByRole('radio')).toHaveCount(0)

  await dialog.getByRole('button', { name: 'New meaning' }).click()
  await dialog.getByLabel('Label', { exact: true }).fill(label)
  await expect(dialog.getByLabel('Key', { exact: true })).toHaveValue(key)
  await dialog.getByRole('radio', { name: 'Green' }).click()
  await dialog.getByRole('button', { name: 'Add meaning' }).click()
  const row = dialog.getByTestId('wb-vocab-row').last()
  await expect(row).toContainText(label)
  await expect(row).toContainText('0 cards')
  // Added and folded away again.
  await expect(dialog.getByRole('radio')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)

  // The new meaning is an option at once, and the card's chip shows it.
  await page.locator('#wb-meaning').click()
  await page.getByRole('option', { name: label }).click()
  await expect(page.getByTestId('wb-card')).toContainText(label)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  expect((await itemOnServer(request, card))?.meaning).toBe(key)

  // In use: the delete is refused, and says why.
  await page.getByRole('button', { name: 'Manage meanings' }).click()
  await expect(row).toContainText('1 card')
  await row.getByRole('button', { name: new RegExp(label, 'i') }).click()
  await expect(row.getByText(`key: ${key}`)).toBeVisible()
  await dialog.getByRole('button', { name: `Delete ${label}` }).click()
  await expect(dialog.getByRole('alert')).toContainText('1 card still uses')

  // Clean up the shared list: free the key, then delete it.
  await request.patch(on(`/items/${card}`), { data: { meaning: null } })
  const gone = await request.delete(`${API}/vocab/meaning/${key}`)
  expect(gone.ok()).toBe(true)
})

test.describe('on a phone, with a finger', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })

  /** A real one-finger gesture (touch + pointer events), not a mouse in disguise. */
  async function fingerDrag(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    const cdp = await page.context().newCDPSession(page)
    const at = (t: number) => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [from],
    })
    for (let step = 1; step <= 12; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [at(step / 12)],
      })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await cdp.detach()
  }

  const sheet = (page: Page) => page.getByRole('dialog', { name: 'Inspector' })

  async function seedTwo(request: APIRequestContext) {
    const ids = [objectId(), objectId()]
    await request.post(on('/items'), {
      data: { _id: ids[0], form: 'text', title: 'Left card', x: 0, y: 0 },
    })
    await request.post(on('/items'), {
      data: { _id: ids[1], form: 'text', title: 'Right card', x: 0, y: 260 },
    })
    return ids
  }

  test('(15) every tool is on the rail, and a tapped tool draws where the finger lands', async ({
    page,
    request,
  }) => {
    await seedTwo(request)
    await openBoard(page)
    const rail = page.getByTestId('wb-tool-rail')
    await expect(rail).toBeVisible()
    for (const name of [
      'Select, V',
      'Select box',
      'Text card, T',
      'To-do card, L',
      'Rectangle, R',
      'Ellipse, O',
      'Diamond, D',
      'Frame, F',
      'Arrow, A',
      'Pen, P',
      'Eraser (ink only), E',
    ])
      await expect(rail.getByRole('button', { name, exact: true })).toHaveCount(
        1
      )
    await expect(page.getByText('Drawing needs a larger screen')).toHaveCount(0)

    await rail.getByRole('button', { name: 'Rectangle, R' }).tap()
    await page.touchscreen.tap(200, 700)
    await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
    // A new item is not selected, so the inspector sheet stays shut.
    await expect(sheet(page)).toHaveCount(0)
    await expect
      .poll(async () =>
        (await boardLines(request)).some(
          line => line.t === 'item' && line.item.form === 'shape'
        )
      )
      .toBe(true)
  })

  test('(16) the pen draws with a finger', async ({ page, request }) => {
    await seedTwo(request)
    await openBoard(page)
    await page.getByRole('button', { name: 'Pen, P' }).tap()
    await fingerDrag(page, { x: 120, y: 620 }, { x: 300, y: 700 })
    await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
    await expect
      .poll(async () =>
        (await boardLines(request)).some(
          line => line.t === 'item' && line.item.form === 'ink'
        )
      )
      .toBe(true)
  })

  test('(17) a finger drag moves a card and leaves the sheet shut; a tap opens it', async ({
    page,
    request,
  }) => {
    const [left] = await seedTwo(request)
    await openBoard(page)
    const from = await centreOf(
      page.getByTestId('wb-card').filter({ hasText: 'Left card' })
    )
    await fingerDrag(page, from, { x: from.x + 40, y: from.y + 120 })
    await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/)
    await expect
      .poll(async () => (await itemOnServer(request, left))?.y)
      .not.toBe(0)
    await expect(sheet(page)).toHaveCount(0)

    await page.getByText('Right card').tap()
    await expect(sheet(page).locator('#wb-title')).toHaveValue('Right card')
  })

  test('(18) one finger pans the board; Select box picks several cards, once', async ({
    page,
    request,
  }) => {
    await seedTwo(request)
    await openBoard(page)
    const viewport = page.locator('.react-flow__viewport')
    const before = await viewport.getAttribute('style')
    // Empty canvas below the cards.
    await fingerDrag(page, { x: 200, y: 720 }, { x: 260, y: 640 })
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(before)
    await expect(sheet(page)).toHaveCount(0)

    const boxButton = page.getByRole('button', { name: 'Select box' })
    await boxButton.tap()
    await expect(boxButton).toHaveAttribute('aria-pressed', 'true')
    const cards = page.getByTestId('wb-card')
    const a = (await cards.nth(0).boundingBox())!
    const b = (await cards.nth(1).boundingBox())!
    await fingerDrag(
      page,
      {
        x: Math.min(a.x, b.x) - 12,
        y: Math.min(a.y, b.y) - 12,
      },
      {
        x: Math.max(a.x + a.width, b.x + b.width) + 12,
        y: Math.max(a.y + a.height, b.y + b.height) + 12,
      }
    )
    await expect(sheet(page)).toContainText('2 items selected')
    // One box, then the finger pans again.
    await expect(boxButton).toHaveAttribute('aria-pressed', 'false')
  })
})
