'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { readBoardStream } from '@/components/whiteboard/board-loader'
import {
  absoluteOrigin,
  movePatch,
  resolveMembership,
  type Placeable,
} from '@/components/whiteboard/frame-geometry'
import { newObjectId } from '@/components/whiteboard/object-id'
import type {
  LinkBody,
  SaveOp,
  UnparentedChild,
} from '@/components/whiteboard/save-queue'
import { useSaveQueue } from '@/components/whiteboard/useSaveQueue'
import {
  STATUS_MEANINGS,
  deriveInkBBox,
  type Form,
  type InkPoint,
  type Meaning,
  type Shape,
} from '@/lib/whiteboard/limits'
import type { ClientItem, ClientLink } from '@/lib/whiteboard/types'
import { getBoardStreamApi } from '@/requests/whiteboard'

/**
 * Board state for the canvas: items, links, per-entity errors, and every action that edits
 * them. Each action updates the canvas at once (optimistic) and hands the write to the queue.
 *
 * ```
 *   load: NDJSON stream ──▶ batches into state ──▶ `end` line ──▶ ready (editable)
 *                                        └ cut / error ─────────▶ error, board cleared
 *
 *   action ──▶ local state (now) ──▶ queue ──▶ server
 *                                               │ 2xx: server doc merged, except fields
 *                                               │      the queue still has pending (R3-1)
 *                                               └ 4xx: entity marked; Discard reverts it
 * ```
 *
 * ## Why a partial board is never editable (DR4)
 *
 * Every edit autosaves. If a stream died at item 80 of 128 and the owner started working,
 * nothing would be lost immediately - but the canvas would be showing a board that is not
 * the real one, and a multi-select drag or a frame delete computed from it would be written
 * back as if it were. So a load either completes (the server's `end` line arrived) or it is
 * an error with a Retry, and the partial state is thrown away.
 *
 * ## Rule 8 on the client (R3-1)
 *
 * When a card is dropped out of a hidden frame, the server writes `includeInAi: false`. The
 * canvas applies the same rule optimistically on drop, so the EyeOff badge is right before
 * the response arrives, and the queue never sends `includeInAi` except from the explicit
 * toggle, so a later title edit cannot undo it.
 */

export interface BoardData {
  items: Record<string, ClientItem>
  links: Record<string, ClientLink>
}

export type LoadState =
  | { phase: 'loading'; total: number; loaded: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

const EMPTY: BoardData = { items: {}, links: {} }

const DEFAULT_SIZE: Record<Form, { width: number; height: number }> = {
  text: { width: 240, height: 120 },
  todo: { width: 240, height: 160 },
  shape: { width: 180, height: 110 },
  frame: { width: 520, height: 360 },
  ink: { width: 1, height: 1 },
}

/** Fields the server accepts on create (limits.ts `validateItem`). */
function createBody(item: ClientItem): Record<string, unknown> {
  return {
    _id: item._id,
    form: item.form,
    meaning: item.meaning,
    status: item.status,
    title: item.title,
    body: item.body,
    todos: item.todos,
    shape: item.shape,
    ink: item.ink ? { points: item.ink.points } : null,
    parentId: item.parentId,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    z: item.z,
    tags: item.tags,
    when: item.when,
    targetBy: item.targetBy,
    includeInAi: item.includeInAi,
  }
}

/** A local edit, as the server wants it: ink without its (server-owned) bbox. */
function patchBody(patch: Partial<ClientItem>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch }
  delete out._id
  delete out.form
  delete out.createdAt
  delete out.updatedAt
  if (patch.ink) out.ink = { points: patch.ink.points }
  return out
}

export function isEffectivelyHidden(
  item: ClientItem,
  items: Record<string, ClientItem>
): boolean {
  if (!item.includeInAi) return true
  if (!item.parentId) return false
  const frame = items[item.parentId]
  return !frame || !frame.includeInAi
}

/** Groups a multi-delete in the queue, and picks "deleted" for its summary. */
const DELETE_GROUP = 'delete-'

/**
 * Take a frame's children out of it in `next`: absolute x/y, and hidden if the frame was
 * (rule 8). Returns them in the shape `queue.unparent` wants.
 */
function unparentLocally(
  frame: ClientItem,
  items: Record<string, ClientItem>,
  next: Record<string, ClientItem>,
  skip: ReadonlySet<string> = new Set()
): UnparentedChild[] {
  const hidden = !frame.includeInAi
  const children: UnparentedChild[] = []
  for (const child of Object.values(items)) {
    if (child.parentId !== frame._id || skip.has(child._id)) continue
    const x = child.x + frame.x
    const y = child.y + frame.y
    next[child._id] = {
      ...child,
      parentId: null,
      x,
      y,
      ...(hidden ? { includeInAi: false } : {}),
    }
    children.push({ id: child._id, x, y, hidden })
  }
  return children
}

function framesOf(items: Record<string, ClientItem>): Placeable[] {
  return Object.values(items)
    .filter(item => item.form === 'frame')
    .map(frame => ({
      id: frame._id,
      form: frame.form,
      parentId: null,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      z: frame.z,
    }))
}

export function useBoard() {
  const [data, setData] = useState<BoardData>(EMPTY)
  const dataRef = useRef<BoardData>(EMPTY)
  const [load, setLoad] = useState<LoadState>({
    phase: 'loading',
    total: 0,
    loaded: 0,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const serverItems = useRef(new Map<string, ClientItem>())
  const serverLinks = useRef(new Map<string, ClientLink>())
  /** A frame's children as they were before a local un-parent, for a refused delete. */
  const serverChildren = useRef(
    new Map<string, Pick<ClientItem, 'parentId' | 'x' | 'y' | 'includeInAi'>>()
  )
  const [notice, setNotice] = useState<string | null>(null)

  const { queue, status, setStatus } = useSaveQueue({
    rejectedCount: Object.keys(errors).length,
  })

  const commit = useCallback((update: (prev: BoardData) => BoardData) => {
    const next = update(dataRef.current)
    dataRef.current = next
    setData(next)
  }, [])

  const clearError = useCallback((id: string) => {
    setErrors(prev => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  // MARK: Server answers

  const mergeServerItem = useCallback(
    (doc: ClientItem) => {
      serverItems.current.set(doc._id, doc)
      const pending = queue.pendingFields(doc._id)
      commit(prev => {
        const local = prev.items[doc._id]
        if (!local) return prev
        const merged: Record<string, unknown> = { ...local }
        for (const [key, value] of Object.entries(doc))
          if (!pending.has(key)) merged[key] = value
        return {
          ...prev,
          items: { ...prev.items, [doc._id]: merged as unknown as ClientItem },
        }
      })
    },
    [commit, queue]
  )

  useEffect(() => {
    queue.setEvents({
      onStatus: setStatus,
      onSaved: (op: SaveOp, raw: unknown) => {
        const body = (raw ?? {}) as {
          item?: ClientItem
          items?: ClientItem[]
          link?: ClientLink
        }
        if (body.item) mergeServerItem(body.item)
        for (const doc of body.items ?? []) mergeServerItem(doc)
        if (body.link) serverLinks.current.set(body.link._id, body.link)
        if (op.type === 'deleteItem') serverItems.current.delete(op.id)
        if (op.type === 'deleteLink') serverLinks.current.delete(op.id)
      },
      onRejected: (op, id, error) => {
        // R3-19: a delete that the server refused puts the card back, marked - with the
        // links it took off the canvas, and its children back inside it if it is a frame
        // (the server changed nothing).
        if (op.type === 'deleteItem') {
          const snapshot = serverItems.current.get(op.id)
          if (snapshot)
            commit(prev => {
              const items = { ...prev.items, [op.id]: snapshot }
              for (const child of Object.values(prev.items)) {
                const before = serverChildren.current.get(child._id)
                if (before?.parentId === op.id && child.parentId === null)
                  items[child._id] = { ...child, ...before }
              }
              const links = { ...prev.links }
              for (const link of serverLinks.current.values())
                if (link.from === op.id || link.to === op.id)
                  links[link._id] = link
              return { items, links }
            })
        }
        if (op.type === 'deleteLink') {
          const snapshot = serverLinks.current.get(op.id)
          if (snapshot)
            commit(prev => ({
              ...prev,
              links: { ...prev.links, [op.id]: snapshot },
            }))
        }
        setErrors(prev => ({ ...prev, [id]: error }))
      },
      onGroupSettled: (groupId, result) => {
        const deleting = groupId.startsWith(DELETE_GROUP)
        const total =
          result.ok.length + result.failed.length + result.skipped.length
        const parts = [
          `${result.ok.length} of ${total} ${deleting ? 'deleted' : 'updated'}`,
        ]
        if (result.failed.length)
          parts.push(
            `${result.failed.length} ${deleting ? 'not deleted' : 'not saved'}`
          )
        if (result.skipped.length)
          parts.push(
            `${result.skipped.length} skipped (a hidden frame or inside one)`
          )
        setNotice(parts.join(' - '))
      },
    })
  }, [commit, mergeServerItem, queue, setStatus])

  // MARK: Load

  const loadBoard = useCallback(
    // Starts from the initial (empty, loading) state; `retryLoad` resets to it first.
    async (signal?: AbortSignal) => {
      const items: Record<string, ClientItem> = {}
      const links: Record<string, ClientLink> = {}
      let total = 0
      let loaded = 0
      try {
        const body = await getBoardStreamApi(signal)
        await readBoardStream(body, lines => {
          for (const line of lines) {
            if (line.t === 'start') total = line.items
            if (line.t === 'item') {
              items[line.item._id] = line.item
              loaded++
            }
            if (line.t === 'link') links[line.link._id] = line.link
          }
          // One state update per network chunk, not per line (D28). Rendered read-only.
          const snapshot = { items: { ...items }, links: { ...links } }
          dataRef.current = snapshot
          setData(snapshot)
          setLoad({ phase: 'loading', total, loaded })
        })
        serverItems.current = new Map(Object.entries(items))
        serverLinks.current = new Map(Object.entries(links))
        // A card deleted earlier this session and brought back by a restore is live again.
        queue.revive([...Object.keys(items), ...Object.keys(links)])
        queue.markPersisted(Object.keys(items))
        setLoad({ phase: 'ready' })
      } catch (error) {
        if (signal?.aborted) return
        console.error('[whiteboard] load failed', error)
        dataRef.current = EMPTY
        setData(EMPTY)
        setLoad({ phase: 'error', message: "Couldn't load the board." })
      }
    },
    [queue]
  )

  useEffect(() => {
    const controller = new AbortController()
    // Every setState in loadBoard runs after an await (the fetch, then each stream chunk),
    // never synchronously in this effect - the compiler cannot see through the async call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBoard(controller.signal)
    return () => controller.abort()
  }, [loadBoard])

  const retryLoad = useCallback(() => {
    dataRef.current = EMPTY
    setData(EMPTY)
    setErrors({})
    setLoad({ phase: 'loading', total: 0, loaded: 0 })
    void loadBoard()
  }, [loadBoard])

  // MARK: Item actions

  const createItem = useCallback(
    (
      form: Form,
      at: { x: number; y: number },
      extra: Partial<ClientItem> = {}
    ): string => {
      const id = newObjectId()
      const size = { ...DEFAULT_SIZE[form] }
      if (extra.width) size.width = extra.width
      if (extra.height) size.height = extra.height
      const membership = resolveMembership(
        { id, form, parentId: null, ...size },
        at,
        framesOf(dataRef.current.items)
      )
      const now = new Date().toISOString()
      const item: ClientItem = {
        _id: id,
        form,
        meaning: null,
        status: null,
        title: '',
        body: '',
        todos: [],
        shape: null,
        ink: null,
        parentId: membership.parentId,
        x: membership.x,
        y: membership.y,
        ...size,
        z: form === 'frame' ? 0 : 1,
        tags: [],
        when: null,
        targetBy: null,
        includeInAi: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      }
      if (item.ink)
        item.ink = { ...item.ink, bbox: deriveInkBBox(item.ink.points) }
      commit(prev => ({ ...prev, items: { ...prev.items, [id]: item } }))
      queue.createItem(id, createBody(item))
      return id
    },
    [commit, queue]
  )

  const updateItem = useCallback(
    (
      id: string,
      patch: Partial<ClientItem>,
      {
        delay,
        group,
        keepChildrenPrivate,
      }: {
        delay?: number
        group?: string
        /** D24: un-hide a frame but write its children hidden first. */
        keepChildrenPrivate?: boolean
      } = {}
    ) => {
      const current = dataRef.current.items[id]
      if (!current) return
      const next = { ...patch }
      // Status lives only next to a dream or goal (limits.ts); mirror it so the UI is honest.
      const meaning = (
        next.meaning !== undefined ? next.meaning : current.meaning
      ) as Meaning | null
      if (!meaning || !STATUS_MEANINGS.includes(meaning))
        if (current.status !== null || next.status) next.status = null

      if (next.ink)
        next.ink = { ...next.ink, bbox: deriveInkBBox(next.ink.points) }
      commit(prev => {
        const items = { ...prev.items, [id]: { ...current, ...next } }
        // Mirror the server (children first, then the frame) so no badge lies meanwhile.
        if (keepChildrenPrivate)
          for (const child of Object.values(prev.items))
            if (child.parentId === id)
              items[child._id] = { ...child, includeInAi: false }
        return { ...prev, items }
      })
      clearError(id)
      queue.patchItem(
        id,
        {
          ...patchBody(next),
          ...(keepChildrenPrivate ? { keepChildrenPrivate: true } : {}),
        },
        { delay, group }
      )
    },
    [clearError, commit, queue]
  )

  /**
   * After a drag stops (D28: never per move). `absolute` is the item's canvas-absolute
   * top-left. Joins/leaves frames, applies rule 8 locally, and writes one bulk PATCH for a
   * multi-select (R3-2) or one PATCH for a single item.
   */
  const moveItems = useCallback(
    (
      moves: {
        id: string
        absolute: { x: number; y: number }
        /** The measured size, for the centre-inside rule (cards grow with their text). */
        size?: { width: number; height: number }
      }[],
      { debounce = false }: { debounce?: boolean } = {}
    ) => {
      const items = dataRef.current.items
      const moving = new Set(moves.map(m => m.id))
      // A child whose frame moves in the same drag rides along (x/y are relative).
      const effective = moves.filter(({ id }) => {
        const parent = items[id]?.parentId
        return !(parent && moving.has(parent))
      })
      const moved = new Map(effective.map(m => [m.id, m.absolute]))
      const sizes = new Map(effective.map(m => [m.id, m.size]))
      const frames = framesOf(items).map(frame =>
        moved.has(frame.id) ? { ...frame, ...moved.get(frame.id)! } : frame
      )
      const updates: {
        id: string
        x: number
        y: number
        parentId: string | null
        changed: boolean
        leftHidden: boolean
      }[] = []
      const nextItems = { ...items }

      for (const { id, absolute } of effective) {
        const item = items[id]
        if (!item) continue
        const size = sizes.get(id)
        const membership = resolveMembership(
          {
            id,
            form: item.form,
            parentId: item.parentId,
            width: size?.width || item.width,
            height: size?.height || item.height,
          },
          absolute,
          frames
        )
        const leftHidden =
          membership.left !== null &&
          (!items[membership.left] || !items[membership.left].includeInAi)
        nextItems[id] = {
          ...item,
          x: membership.x,
          y: membership.y,
          parentId: membership.parentId,
          ...(leftHidden ? { includeInAi: false } : {}),
        }
        updates.push({
          id,
          x: membership.x,
          y: membership.y,
          parentId: membership.parentId,
          changed: membership.changed,
          leftHidden,
        })
      }
      commit(prev => ({ ...prev, items: nextItems }))
      for (const update of updates) clearError(update.id)

      const persisted = updates.filter(u => queue.isPersisted(u.id))
      const fresh = updates.filter(u => !queue.isPersisted(u.id))
      // Arrow-key nudges are debounced per item (DR9); a drag is one immediate write, and a
      // multi-select drag is one bulk PATCH (R3-2).
      if (persisted.length > 1 && !debounce)
        queue.bulkMove(
          persisted.map(({ id, x, y, parentId }) => ({ id, x, y, parentId }))
        )
      else fresh.push(...persisted)
      for (const u of fresh)
        queue.patchItem(
          u.id,
          movePatch(u, u.leftHidden),
          debounce ? {} : { delay: 0 }
        )
    },
    [clearError, commit, queue]
  )

  const deleteItems = useCallback(
    (ids: string[]) => {
      const { items, links } = dataRef.current
      const doomed = new Set(ids.filter(id => items[id]))
      const nextItems = { ...items }
      const orphans = new Map<string, UnparentedChild[]>()
      for (const id of doomed) {
        const item = items[id]
        if (item.form === 'frame') {
          // Mirror the server's safe order locally: children stay, converted to absolute,
          // and a hidden frame's children stay hidden (rule 8).
          const children = unparentLocally(item, items, nextItems, doomed)
          for (const child of children) {
            const { parentId, x, y, includeInAi } = items[child.id]
            serverChildren.current.set(child.id, {
              parentId,
              x,
              y,
              includeInAi,
            })
            serverItems.current.set(child.id, nextItems[child.id])
          }
          orphans.set(id, children)
        }
        delete nextItems[id]
      }
      const nextLinks = { ...links }
      for (const link of Object.values(links))
        if (doomed.has(link.from) || doomed.has(link.to))
          delete nextLinks[link._id]
      commit(() => ({ items: nextItems, links: nextLinks }))
      // The children's own queued writes still name the frame; rewrite them first.
      for (const [frameId, children] of orphans)
        queue.unparent(frameId, children)
      // R3-19: one DELETE per item, each through that item's own queue, with a per-item
      // summary ("4 of 5 deleted - 1 not deleted") when there is more than one.
      const group = doomed.size > 1 ? `${DELETE_GROUP}${Date.now()}` : undefined
      if (group) queue.openGroup(group)
      for (const id of doomed) {
        clearError(id)
        queue.deleteItem(id, { group })
      }
      if (group) queue.closeGroup(group)
    },
    [clearError, commit, queue]
  )

  // MARK: Link actions

  const connect = useCallback(
    (
      from: string,
      to: string,
      fromHandle: string | null,
      toHandle: string | null
    ) => {
      if (from === to) return null
      const exists = Object.values(dataRef.current.links).some(
        l => l.from === from && l.to === to && l.label === ''
      )
      if (exists) return null
      const link: LinkBody = {
        _id: newObjectId(),
        from,
        to,
        label: '',
        fromHandle,
        toHandle,
      }
      commit(prev => ({ ...prev, links: { ...prev.links, [link._id]: link } }))
      queue.createLink(link)
      return link._id
    },
    [commit, queue]
  )

  const updateLinkLabel = useCallback(
    (id: string, label: string) => {
      const link = dataRef.current.links[id]
      if (!link || link.label === label) return
      commit(prev => ({
        ...prev,
        links: { ...prev.links, [id]: { ...link, label } },
      }))
      clearError(id)
      queue.patchLink(id, label)
    },
    [clearError, commit, queue]
  )

  const deleteLinks = useCallback(
    (ids: string[]) => {
      commit(prev => {
        const links = { ...prev.links }
        for (const id of ids) delete links[id]
        return { ...prev, links }
      })
      for (const id of ids) {
        clearError(id)
        queue.deleteLink(id)
      }
    },
    [clearError, commit, queue]
  )

  /** DR4: "Discard" on a card the server rejected. Reverts it, or removes it if it never saved. */
  const discard = useCallback(
    (id: string) => {
      // A frame that never saved goes away entirely; its children stay, un-parented, and
      // their writes stop waiting on it.
      const frame = dataRef.current.items[id]
      if (frame?.form === 'frame' && !serverItems.current.has(id)) {
        const items = { ...dataRef.current.items }
        const children = unparentLocally(frame, dataRef.current.items, items)
        commit(prev => ({ ...prev, items }))
        queue.unparent(id, children)
      }
      const droppedLinks = queue.discard(id)
      commit(prev => {
        const items = { ...prev.items }
        const links = { ...prev.links }
        for (const linkId of droppedLinks) delete links[linkId]
        if (items[id]) {
          const snapshot = serverItems.current.get(id)
          if (snapshot) items[id] = snapshot
          else delete items[id]
        }
        if (links[id]) {
          const snapshot = serverLinks.current.get(id)
          if (snapshot) links[id] = snapshot
          else delete links[id]
        }
        return { items, links }
      })
      clearError(id)
    },
    [clearError, commit, queue]
  )

  /** Points are local to `origin`, the stroke's top-left, so its box is its bbox. */
  const addInk = useCallback(
    (points: InkPoint[], origin: { x: number; y: number }) => {
      const bbox = deriveInkBBox(points)
      return createItem('ink', origin, {
        ink: { points, bbox },
        width: Math.max(1, Math.round(bbox.maxX - bbox.minX)),
        height: Math.max(1, Math.round(bbox.maxY - bbox.minY)),
      })
    },
    [createItem]
  )

  const addShape = useCallback(
    (shape: Shape, at: { x: number; y: number }) =>
      createItem('shape', at, {
        shape,
        ...(shape === 'rect' ? {} : { width: 160, height: 130 }),
      }),
    [createItem]
  )

  const absoluteOf = useCallback((id: string) => {
    const items = dataRef.current.items
    const item = items[id]
    if (!item) return null
    return absoluteOrigin(item, new Map(Object.entries(items)))
  }, [])

  const hiddenCount = useMemo(
    () =>
      Object.values(data.items).filter(item =>
        isEffectivelyHidden(item, data.items)
      ).length,
    [data.items]
  )

  return {
    data,
    dataRef,
    load,
    retryLoad,
    errors,
    status,
    queue,
    hiddenCount,
    notice,
    setNotice,
    actions: {
      createItem,
      addShape,
      addInk,
      updateItem,
      moveItems,
      deleteItems,
      connect,
      updateLinkLabel,
      deleteLinks,
      discard,
      absoluteOf,
      retryAll: () => queue.retryAll(),
    },
  }
}

export type Board = ReturnType<typeof useBoard>
export type BoardActions = Board['actions']
