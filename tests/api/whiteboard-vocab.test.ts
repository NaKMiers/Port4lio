import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { getAuthCookieName, makeAuthToken } from '@/lib/auth'
import { renderContext, renderOverview } from '@/lib/whiteboard/context'
import {
  createAgentItem,
  createItem,
  loadAgentVisible,
  patchItem,
  restoreBatch,
} from '@/lib/whiteboard/data'
import { validateItem, type ItemFields } from '@/lib/whiteboard/limits'
import { DEFAULT_VOCAB } from '@/lib/whiteboard/vocab'
import { editVocab, getVocab } from '@/lib/whiteboard/vocab-service'
import { WhiteboardBoardModel } from '@/models/WhiteboardBoard'
import { WhiteboardItemModel } from '@/models/WhiteboardItem'
import { WhiteboardVocabModel } from '@/models/WhiteboardVocab'

/**
 * The owner-editable meanings and statuses (vocab.ts, vocab-service.ts), against a real
 * mongod: the seed, the edit rules, the in-use guards, and every item write checking a key
 * the list really has.
 *
 * ```
 *   first read seeds the defaults once ─ a deleted default stays deleted
 *   create / relabel / recolour / move ─ a key is permanent
 *   delete or "no status" while cards use it ──▶ 409 with the count
 *   createItem / patchItem / restore / agent add ──▶ an unknown key is a 400 naming the list
 *   the export and the overview group, order and prioritise by the list
 * ```
 */

let memory: MongoMemoryServer
let BOARD = ''

beforeAll(async () => {
  memory = await MongoMemoryServer.create()
  process.env.MONGODB_URI = memory.getUri()
  process.env.AUTH_SECRET = 'whiteboard-vocab-secret'
  delete process.env.REQUIRE_ADMIN
  await mongoose.connect(memory.getUri())
  BOARD = String(
    (await WhiteboardBoardModel.create({ title: 'Vocab board' }))._id
  )
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await memory.stop()
})

afterEach(async () => {
  await WhiteboardItemModel.deleteMany({})
  await WhiteboardVocabModel.deleteMany({})
})

const newId = () => new mongoose.Types.ObjectId().toHexString()

function fields(overrides: Record<string, unknown> = {}): ItemFields {
  const result = validateItem({
    _id: newId(),
    form: 'text',
    title: 'Card',
    ...overrides,
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function make(overrides: Record<string, unknown> = {}) {
  const result = await createItem(BOARD, fields(overrides))
  if (!result.ok) throw new Error(result.error)
  return result.value
}

async function ok(edit: Parameters<typeof editVocab>[0]) {
  const result = await editVocab(edit)
  if (!result.ok) throw new Error(result.error)
  return result.vocab
}

describe('the list', () => {
  it('starts as the original meanings and statuses, and reading it writes nothing', async () => {
    expect(await getVocab()).toEqual(DEFAULT_VOCAB)
    const first = await WhiteboardVocabModel.findById('vocab').lean()
    await getVocab()
    await getVocab()
    const later = await WhiteboardVocabModel.findById('vocab').lean()
    expect(later?.updatedAt).toEqual(first?.updatedAt)
  })

  it('a deleted default stays deleted: the seed only runs once', async () => {
    await ok({ type: 'delete', kind: 'meaning', key: 'draft' })
    const vocab = await getVocab()
    expect(vocab.meanings.map(m => m.key)).not.toContain('draft')
  })

  it('creates a meaning with a key made from its label, then relabels, recolours and moves it', async () => {
    let vocab = await ok({
      type: 'create',
      kind: 'meaning',
      entry: { label: 'Side project', tone: 'green', icon: 'star' },
    })
    expect(vocab.meanings.at(-1)).toEqual({
      key: 'side-project',
      label: 'Side project',
      tone: 'green',
      icon: 'star',
      tracksStatus: false,
    })
    vocab = await ok({
      type: 'update',
      kind: 'meaning',
      key: 'side-project',
      changes: { label: 'Side quest', tone: 'rose', icon: null },
    })
    expect(vocab.meanings.at(-1)).toMatchObject({
      key: 'side-project',
      label: 'Side quest',
      tone: 'rose',
      icon: null,
    })
    vocab = await ok({
      type: 'move',
      kind: 'meaning',
      key: 'side-project',
      to: 0,
    })
    expect(vocab.meanings[0].key).toBe('side-project')
    expect(await getVocab()).toEqual(vocab)
  })

  it('refuses a duplicate key, a key change, a bad label and an unknown entry', async () => {
    expect(
      await editVocab({
        type: 'create',
        kind: 'status',
        entry: { label: 'Active again', key: 'active' },
      })
    ).toMatchObject({ ok: false, status: 409 })
    expect(
      await editVocab({
        type: 'update',
        kind: 'meaning',
        key: 'goal',
        changes: { key: 'objective' },
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await editVocab({
        type: 'create',
        kind: 'meaning',
        entry: { label: 'x'.repeat(41) },
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await editVocab({ type: 'delete', kind: 'status', key: 'nope' })
    ).toMatchObject({ ok: false, status: 404 })
  })

  it('two edits at once both land: a lost race re-applies on a fresh read', async () => {
    await getVocab()
    await Promise.all([
      ok({ type: 'create', kind: 'status', entry: { label: 'Blocked' } }),
      ok({ type: 'create', kind: 'status', entry: { label: 'Waiting' } }),
    ])
    const keys = (await getVocab()).statuses.map(s => s.key)
    expect(keys).toEqual(expect.arrayContaining(['blocked', 'waiting']))
  })
})

describe('in-use guards', () => {
  it('a meaning or status a card carries cannot be deleted; the refusal counts them', async () => {
    await make({ meaning: 'goal', status: 'done' })
    await make({ meaning: 'goal' })
    const meaning = await editVocab({
      type: 'delete',
      kind: 'meaning',
      key: 'goal',
    })
    expect(meaning).toMatchObject({ ok: false, status: 409 })
    expect(!meaning.ok && meaning.error).toContain('2 cards')
    expect(
      await editVocab({ type: 'delete', kind: 'status', key: 'done' })
    ).toMatchObject({ ok: false, status: 409 })
    // Unused ones go.
    await ok({ type: 'delete', kind: 'status', key: 'someday' })
    await ok({ type: 'delete', kind: 'meaning', key: 'draft' })
  })

  it('"no status" is refused while cards of the meaning still carry one', async () => {
    const card = await make({ meaning: 'dream', status: 'active' })
    expect(
      await editVocab({
        type: 'update',
        kind: 'meaning',
        key: 'dream',
        changes: { tracksStatus: false },
      })
    ).toMatchObject({ ok: false, status: 409 })
    await patchItem(BOARD, card._id, { status: null })
    const vocab = await ok({
      type: 'update',
      kind: 'meaning',
      key: 'dream',
      changes: { tracksStatus: false },
    })
    expect(vocab.meanings.find(m => m.key === 'dream')?.tracksStatus).toBe(
      false
    )
  })
})

describe('item writes use the list', () => {
  it('a custom meaning and status can be written, and a status sticks only where the meaning has one', async () => {
    await ok({
      type: 'create',
      kind: 'meaning',
      entry: { label: 'Habit', tracksStatus: true },
    })
    await ok({ type: 'create', kind: 'status', entry: { label: 'Streak' } })
    const habit = await make({ meaning: 'habit', status: 'streak' })
    expect(habit).toMatchObject({ meaning: 'habit', status: 'streak' })

    const note = await make({ meaning: 'note', status: 'streak' })
    expect(note.status).toBeNull()
    const moved = await patchItem(BOARD, habit._id, { meaning: 'note' })
    expect(moved.ok && moved.value.status).toBeNull()
  })

  it('an unknown key is refused by name on create, patch, restore and the agent add', async () => {
    const created = await createItem(BOARD, fields({ meaning: 'ghost' }))
    expect(created).toMatchObject({ ok: false, status: 400 })
    expect(!created.ok && created.error).toContain(
      'dream, goal, failure, draft, note'
    )

    const card = await make()
    expect(await patchItem(BOARD, card._id, { status: 'ghost' })).toMatchObject(
      { ok: false, status: 400 }
    )

    const restored = await restoreBatch(BOARD, {
      items: [{ _id: newId(), form: 'text', title: 'Old', meaning: 'ghost' }],
      links: [],
      dryRun: false,
      overwrite: false,
    })
    expect(restored).toMatchObject({ ok: false, status: 400 })

    expect(
      await createAgentItem({
        form: 'text',
        title: 'From an agent',
        meaning: 'ghost',
      })
    ).toMatchObject({ ok: false, status: 400 })
  })

  it('a card keeps a key the list lost: it can still be moved and retitled', async () => {
    await ok({ type: 'create', kind: 'meaning', entry: { label: 'Temp' } })
    const card = await make({ meaning: 'temp' })
    // Removed behind the guard's back, as a race or a manual edit could.
    await WhiteboardVocabModel.updateOne(
      { _id: 'vocab' },
      { $pull: { meanings: { key: 'temp' } } }
    )
    const retitled = await patchItem(BOARD, card._id, {
      title: 'Still here',
      x: 40,
    })
    expect(retitled.ok && retitled.value).toMatchObject({
      title: 'Still here',
      meaning: 'temp',
    })
  })
})

describe('what agents read', () => {
  it('the export groups by the list order and labels, and the overview lists the keys', async () => {
    await ok({
      type: 'create',
      kind: 'meaning',
      entry: { label: 'Idea', tracksStatus: true },
    })
    await ok({ type: 'move', kind: 'meaning', key: 'idea', to: 0 })
    await make({ meaning: 'goal', title: 'A goal' })
    await make({ meaning: 'idea', status: 'active', title: 'An idea' })

    const { input } = await loadAgentVisible({ kind: 'all' })
    const { markdown } = renderContext(input)
    const headings = markdown.match(/^### .+$/gm)
    expect(headings).toEqual(['### Idea', '### Goal'])

    const overview = renderOverview(
      await loadAgentVisible({ kind: 'overview' })
    )
    expect(overview).toContain('idea (Idea, has a status)')
    expect(overview).toContain('Statuses: active (Active)')
    // An active item of a custom meaning that has a status is a priority, like a goal.
    expect(overview).toMatch(/## Active \(idea, dream, goal\)\n- An idea/)
  })
})

describe('the owner routes', () => {
  const cookie = () =>
    `${getAuthCookieName()}=${makeAuthToken(Date.now() + 3_600_000)}`
  const request = (url: string, method: string, body?: unknown, owner = true) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: {
        ...(owner ? { cookie: cookie() } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  it('refuse without the owner cookie, and answer the whole list and usage', async () => {
    const collection = await import('@/app/api/admin/whiteboard/vocab/route')
    const entry =
      await import('@/app/api/admin/whiteboard/vocab/[kind]/[key]/route')
    const params = (kind: string, key: string) => ({
      params: Promise.resolve({ kind, key }),
    })

    expect(
      (
        await collection.GET(
          request('/api/admin/whiteboard/vocab', 'GET', undefined, false)
        )
      ).status
    ).toBe(401)
    expect(
      (
        await entry.DELETE(
          request(
            '/api/admin/whiteboard/vocab/status/done',
            'DELETE',
            undefined,
            false
          ),
          params('status', 'done')
        )
      ).status
    ).toBe(401)

    await make({ meaning: 'goal' })
    const listed = await (
      await collection.GET(request('/api/admin/whiteboard/vocab', 'GET'))
    ).json()
    expect(listed.vocab).toEqual(DEFAULT_VOCAB)
    expect(listed.usage.meanings).toEqual({ goal: 1 })

    const created = await collection.POST(
      request('/api/admin/whiteboard/vocab', 'POST', {
        kind: 'status',
        label: 'Blocked',
      })
    )
    expect(created.status).toBe(200)
    expect((await created.json()).vocab.statuses.at(-1)).toEqual({
      key: 'blocked',
      label: 'Blocked',
    })

    const moved = await entry.PATCH(
      request('/api/admin/whiteboard/vocab/status/blocked', 'PATCH', { to: 0 }),
      params('status', 'blocked')
    )
    expect((await moved.json()).vocab.statuses[0].key).toBe('blocked')

    const refused = await entry.DELETE(
      request('/api/admin/whiteboard/vocab/meaning/goal', 'DELETE'),
      params('meaning', 'goal')
    )
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toContain('1 card')

    expect(
      (
        await collection.POST(
          request('/api/admin/whiteboard/vocab', 'POST', {
            kind: 'colour',
            label: 'x',
          })
        )
      ).status
    ).toBe(400)
  })
})
