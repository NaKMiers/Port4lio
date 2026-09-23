import { LIMITS, type BulkPositionUpdate } from '@/lib/whiteboard/limits'

/**
 * The canvas save queue, with no React and no fetch in it (both are injected).
 *
 * ```
 *   edit ──▶ enqueue(op)            one FIFO per entity key (item:<id>, link:<id>)
 *              │ coalesce           a patch merges into a queued patch/create of the same key
 *              ▼
 *   pump ──▶ runnable?              head of EVERY key it holds (a bulk move holds many)
 *              │                    · not before its debounce (~600 ms for edits)
 *              │                    · deps persisted: link ends, a new parentId (R3-3)
 *              ▼
 *   send ──▶ 2xx ─────────▶ saved: mark persisted, report the server doc (R3-1 merge)
 *          ├ 0 / 5xx ────▶ retry with backoff 1s, 2s, 4s ... 30s    (pill: N not saved)
 *          │ 401/408/429    (also a timed-out fetch, which is a 0)
 *          └ other 4xx ──▶ permanent: reported, never retried
 *                           · create rejected: stays at the head, blocked, until the next
 *                             edit fixes it or `discard` drops it and what depends on it
 *                           · PATCH rejected: its fields ride along with the next edit of
 *                             that item, so they are re-sent, not forgotten
 *                           · bulk rejected naming one entry: that entry is reported, the
 *                             rest are re-queued without it (R3-15)
 *                           · 404 on PATCH: discarded; 404 on DELETE: already gone (R3-6)
 * ```
 *
 * ## Why 401, 408 and 429 are retried although they are 4xx
 *
 * "4xx is permanent" (the design doc) is about the server refusing the CONTENT - a title over
 * 200 characters stays over 200 characters however often it is sent. These three refuse the
 * MOMENT: an expired owner session (sign in again in another tab and the same request
 * succeeds), a timeout, a rate limit. Treating an expired session as permanent used to drop
 * every edit made after it, with the next edit clearing the error so nothing even warned.
 *
 * ## Why ids come from the client
 *
 * A card, and a link to it, can exist on the canvas before either has reached the server.
 * With client ObjectIds the link's POST can name the card's id immediately and simply wait
 * for the card's create to resolve, and a retried create is a harmless upsert.
 *
 * ## Delete (R3-6)
 *
 * A delete goes into the item's own queue behind its create, pending edits for it are
 * dropped, and so are queued link writes that touch it (the server deletes those links with
 * the item). A create that was never sent is dropped together with the delete - nothing to
 * undo on the server. Once deleted, an id is dead for the session: nothing is ever enqueued
 * for it again, and an in-flight create that fails after the delete is not retried. The
 * server keeps no tombstone, so this client rule is the whole guarantee that a deleted card
 * does not come back.
 *
 * The one way back is the server itself listing the id again - a board load after "Restore
 * from backup" (`revive`). Without that, every edit to a restored card was dropped in
 * silence for the rest of the session, which is exactly the recovery path D20 exists for.
 *
 * ## Why a bulk move holds every key at once
 *
 * A multi-select drag writes 50 positions in one request. If it ran beside those items'
 * own queues, a later single-card nudge could land before it and then be overwritten by it.
 * Holding the head of every entry's queue gives the bulk the same ordering guarantee as any
 * per-item write.
 */

export type LinkBody = {
  _id: string
  from: string
  to: string
  label: string
  fromHandle: string | null
  toHandle: string | null
}

export type SaveOp =
  | { type: 'createItem'; id: string; body: Record<string, unknown> }
  | { type: 'patchItem'; id: string; patch: Record<string, unknown> }
  | { type: 'deleteItem'; id: string }
  | { type: 'createLink'; id: string; body: LinkBody }
  | { type: 'patchLink'; id: string; label: string }
  | { type: 'deleteLink'; id: string }
  | { type: 'bulkMove'; entries: BulkPositionUpdate[] }

/** `status: 0` is a network failure (fetch threw). */
export type SendResult =
  | { ok: true; data?: unknown }
  | { ok: false; status: number; error: string; id?: string }

export interface QueueStatus {
  /** Jobs queued or in flight, rejected ones excluded. */
  pending: number
  inFlight: number
  /** Jobs whose last attempt failed and that will be retried. */
  failing: number
  online: boolean
}

export interface GroupResult {
  ok: string[]
  failed: string[]
  skipped: string[]
}

export interface SaveQueueEvents {
  onSaved?: (op: SaveOp, data: unknown) => void
  /** A permanent 4xx. `id` is the entity the error belongs to. */
  onRejected?: (op: SaveOp, id: string, error: string) => void
  onStatus?: (status: QueueStatus) => void
  onGroupSettled?: (groupId: string, result: GroupResult) => void
}

export interface SaveQueueDeps {
  send: (op: SaveOp) => Promise<SendResult>
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface Job {
  seq: number
  op: SaveOp
  keys: string[]
  deps: Set<string>
  notBefore: number
  attempts: number
  retryAt: number
  inFlight: boolean
  /** Sent at least once - the server may have it even if we never saw the answer. */
  sent: boolean
  /** A 4xx create, parked at the head of its key until fixed or discarded. */
  rejected: boolean
  groups: Set<string>
}

export const PATCH_DEBOUNCE_MS = 600
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
/** 4xx answers about the moment, not the content - see the header. */
const RETRYABLE_4XX = new Set([401, 408, 429])

/** A child of a frame that is going away: where it ends up, canvas-absolute. */
export interface UnparentedChild {
  id: string
  x: number
  y: number
  /** The frame was hidden, so the child is written hidden (rule 8). */
  hidden: boolean
}

const itemKey = (id: string) => `item:${id}`
const linkKey = (id: string) => `link:${id}`

export class SaveQueue {
  private jobs: Job[] = []
  private seq = 0
  private persisted = new Set<string>()
  private deleted = new Set<string>()
  /** Fields of a 4xx PATCH, kept until the next edit of the item re-sends them. */
  private rejectedPatches = new Map<string, Record<string, unknown>>()
  private online = true
  /** The board page is gone: send what can go now, but set no more timers (no retries). */
  private stopped = false
  private timer: unknown = null
  private groups = new Map<
    string,
    { ids: Set<string>; result: GroupResult; closed: boolean }
  >()
  private readonly send: SaveQueueDeps['send']
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(
    deps: SaveQueueDeps,
    private events: SaveQueueEvents = {}
  ) {
    this.send = deps.send
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer =
      deps.clearTimer ??
      (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  setEvents(events: SaveQueueEvents) {
    this.events = events
  }

  // MARK: Public API

  /** Items that already exist on the server (the loaded board). */
  markPersisted(ids: Iterable<string>) {
    for (const id of ids) this.persisted.add(id)
    this.pump()
  }

  /**
   * The server just listed these ids (a board load after a restore), so a session delete no
   * longer applies to them. An id that still has a job queued keeps the rule: its DELETE has
   * not run yet, and reviving it would let an edit race that delete.
   */
  revive(ids: Iterable<string>) {
    for (const id of ids) {
      if (!this.deleted.has(id)) continue
      const keys = [itemKey(id), linkKey(id)]
      if (this.jobs.some(job => job.keys.some(key => keys.includes(key))))
        continue
      this.deleted.delete(id)
    }
  }

  isPersisted(id: string) {
    return this.persisted.has(id)
  }

  isDeleted(id: string) {
    return this.deleted.has(id)
  }

  createItem(id: string, body: Record<string, unknown>) {
    if (this.deleted.has(id)) return
    const parentId = body.parentId
    this.push(
      {
        type: 'createItem',
        id,
        body,
      },
      [itemKey(id)],
      typeof parentId === 'string' ? [parentId] : [],
      0
    )
  }

  /**
   * Only the fields that changed (R3-1). Coalesces into a queued, not-in-flight patch or
   * create for the same item, and restarts the debounce.
   */
  patchItem(
    id: string,
    patch: Record<string, unknown>,
    {
      delay = PATCH_DEBOUNCE_MS,
      group,
    }: { delay?: number; group?: string } = {}
  ) {
    if (this.deleted.has(id)) return
    const carried = this.rejectedPatches.get(id)
    if (carried) {
      // The rejected fields go out again with this edit: either it fixes them, or the server
      // rejects them again and the card is marked again. Never silently forgotten.
      this.rejectedPatches.delete(id)
      patch = { ...carried, ...patch }
    }
    const deps =
      typeof patch.parentId === 'string' ? [patch.parentId] : ([] as string[])
    // Fixing a rejected create is just editing it: the merged body goes out again.
    const parked = this.jobs.find(
      j => j.rejected && j.op.type === 'createItem' && j.op.id === id
    )
    if (parked && parked.op.type === 'createItem') {
      parked.op = { ...parked.op, body: { ...parked.op.body, ...patch } }
      parked.rejected = false
      parked.attempts = 0
      parked.retryAt = 0
      for (const dep of deps) parked.deps.add(dep)
      if (group) this.joinGroup(parked, group, id)
      this.pump()
      return
    }

    const tail = this.tailOf(itemKey(id))
    if (tail && !tail.inFlight && tail.keys.length === 1) {
      if (tail.op.type === 'patchItem') {
        tail.op = { ...tail.op, patch: { ...tail.op.patch, ...patch } }
        tail.notBefore = this.now() + delay
        for (const dep of deps) tail.deps.add(dep)
        if (group) this.joinGroup(tail, group, id)
        this.pump()
        return
      }
      // Only into a create that never left. One that was sent and is waiting to retry may
      // already be on the server, where `$setOnInsert` would ignore the merged fields.
      if (tail.op.type === 'createItem' && !tail.sent) {
        tail.op = { ...tail.op, body: { ...tail.op.body, ...patch } }
        for (const dep of deps) tail.deps.add(dep)
        if (group) this.joinGroup(tail, group, id)
        this.pump()
        return
      }
    }

    const job = this.push(
      { type: 'patchItem', id, patch },
      [itemKey(id)],
      deps,
      delay
    )
    if (job && group) this.joinGroup(job, group, id)
  }

  deleteItem(id: string, { group }: { group?: string } = {}) {
    if (this.deleted.has(id)) return
    this.deleted.add(id)
    this.rejectedPatches.delete(id)

    const key = itemKey(id)
    let createNeverSent = false
    for (const job of [...this.jobs]) {
      if (job.inFlight) continue
      if (job.keys.includes(key)) {
        if (job.op.type === 'bulkMove') {
          this.shrinkBulk(job, entry => entry.id !== id)
          continue
        }
        if (job.op.type === 'createItem' && !job.sent) createNeverSent = true
        // In a bulk edit, an item deleted before its write went out is "not saved".
        this.drop(job, 'failed')
        continue
      }
      // Queued link writes that touch this item: the server deletes those links with it.
      if (
        job.op.type === 'createLink' &&
        (job.op.body.from === id || job.op.body.to === id)
      ) {
        this.deleted.add(job.op.id)
        this.drop(job, 'skipped')
      }
    }

    const inFlightCreate = this.jobs.some(
      j => j.inFlight && j.op.type === 'createItem' && j.op.id === id
    )
    if (createNeverSent && !inFlightCreate && !this.persisted.has(id)) {
      // Nothing to undo on the server: in a multi-delete this one is simply done.
      this.groups.get(group ?? '')?.result.ok.push(id)
      this.emitStatus()
      return
    }
    const job = this.push({ type: 'deleteItem', id }, [key], [], 0, true)
    if (job && group) this.joinGroup(job, group, id)
  }

  /**
   * A frame is going away (deleted, or a never-saved frame discarded), and these children
   * stay on the canvas at absolute positions. Their queued writes still say `parentId:
   * <frame>` with relative x/y, and wait on the frame's create. Rewritten here:
   *
   * ```
   *   queued create / patch / bulk entry of a child  ──▶ parentId null, absolute x/y,
   *                                                       includeInAi false if hidden,
   *                                                       no longer waits on the frame
   *   child write IN FLIGHT with parentId = frame     ──▶ a follow-up patch behind it
   *                                                       (the frame's DELETE also waits
   *                                                       for it - see runnable)
   * ```
   *
   * Without this, a child created in a frame that never saved waited forever, and one racing
   * the frame's DELETE got a 400 that no edit could fix.
   */
  unparent(frameId: string, children: UnparentedChild[]) {
    for (const child of children) {
      const place = {
        parentId: null,
        x: child.x,
        y: child.y,
        ...(child.hidden ? { includeInAi: false } : {}),
      }
      const key = itemKey(child.id)
      let followUp = false
      for (const job of this.jobs) {
        if (!job.keys.includes(key)) continue
        const { op } = job
        if (job.inFlight) {
          const carries =
            (op.type === 'createItem' && op.body.parentId === frameId) ||
            (op.type === 'patchItem' && op.patch.parentId === frameId) ||
            (op.type === 'bulkMove' &&
              op.entries.some(e => e.id === child.id && e.parentId === frameId))
          if (carries) followUp = true
          continue
        }
        job.deps.delete(frameId)
        if (op.type === 'createItem')
          job.op = { ...op, body: { ...op.body, ...place } }
        if (
          op.type === 'patchItem' &&
          ('parentId' in op.patch || 'x' in op.patch || 'y' in op.patch)
        )
          job.op = { ...op, patch: { ...op.patch, ...place } }
        if (op.type === 'bulkMove')
          job.op = {
            ...op,
            entries: op.entries.map(entry =>
              entry.id === child.id
                ? { id: entry.id, x: child.x, y: child.y, parentId: null }
                : entry
            ),
          }
      }
      if (followUp)
        this.push(
          { type: 'patchItem', id: child.id, patch: place },
          [key],
          [],
          0
        )
    }
    this.pump()
  }

  createLink(body: LinkBody) {
    if (this.deleted.has(body._id)) return
    if (this.deleted.has(body.from) || this.deleted.has(body.to)) return
    this.push(
      { type: 'createLink', id: body._id, body },
      [linkKey(body._id)],
      [body.from, body.to],
      0
    )
  }

  patchLink(
    id: string,
    label: string,
    { delay = PATCH_DEBOUNCE_MS }: { delay?: number } = {}
  ) {
    if (this.deleted.has(id)) return
    const tail = this.tailOf(linkKey(id))
    if (tail && !tail.inFlight) {
      if (tail.op.type === 'patchLink') {
        tail.op = { ...tail.op, label }
        tail.notBefore = this.now() + delay
        this.pump()
        return
      }
      if (tail.op.type === 'createLink' && (!tail.sent || tail.rejected)) {
        tail.op = { ...tail.op, body: { ...tail.op.body, label } }
        tail.rejected = false
        tail.attempts = 0
        tail.retryAt = 0
        this.pump()
        return
      }
    }
    this.push({ type: 'patchLink', id, label }, [linkKey(id)], [], delay)
  }

  deleteLink(id: string) {
    if (this.deleted.has(id)) return
    this.deleted.add(id)
    const key = linkKey(id)
    let createNeverSent = false
    let createInFlight = false
    for (const job of [...this.jobs]) {
      if (!job.keys.includes(key)) continue
      if (job.inFlight) {
        if (job.op.type === 'createLink') createInFlight = true
        continue
      }
      if (job.op.type === 'createLink' && !job.sent) createNeverSent = true
      this.drop(job, 'skipped')
    }
    if (createNeverSent && !createInFlight) {
      this.emitStatus()
      return
    }
    this.push({ type: 'deleteLink', id }, [key], [], 0, true)
  }

  /**
   * A multi-select drag: one request, holding every entry's queue (R3-15 on failure). Split
   * at the server's cap (`LIMITS.bulkUpdates`), which rejects a bigger body whole and names
   * no entry, so a 600-card drag would otherwise never save.
   */
  bulkMove(entries: BulkPositionUpdate[]) {
    const live = entries.filter(entry => !this.deleted.has(entry.id))
    for (let i = 0; i < live.length; i += LIMITS.bulkUpdates) {
      const chunk = live.slice(i, i + LIMITS.bulkUpdates)
      const parents = chunk
        .map(entry => entry.parentId)
        .filter((p): p is string => Boolean(p))
      this.push(
        { type: 'bulkMove', entries: chunk },
        chunk.map(entry => itemKey(entry.id)),
        parents,
        0
      )
    }
  }

  /**
   * DR11 fan-out: register the ids a bulk edit touched, then enqueue one op per id with
   * `{ group }`. The group settles once every id has been saved, rejected or skipped.
   */
  openGroup(groupId: string, skipped: string[] = []) {
    this.groups.set(groupId, {
      ids: new Set(),
      result: { ok: [], failed: [], skipped: [...skipped] },
      closed: false,
    })
  }

  closeGroup(groupId: string) {
    const group = this.groups.get(groupId)
    if (!group) return
    group.closed = true
    this.settleGroupIfDone(groupId)
  }

  /**
   * Drop what is queued for an entity after a permanent error, and everything that depends
   * on it: a link waiting for a card whose create was rejected goes too. Returns the link
   * ids dropped, so the caller can remove them from the canvas.
   */
  discard(id: string): string[] {
    this.rejectedPatches.delete(id)
    const droppedLinks: string[] = []
    for (const job of [...this.jobs]) {
      if (job.inFlight) continue
      const mine =
        job.keys.includes(itemKey(id)) || job.keys.includes(linkKey(id))
      const dependent =
        job.op.type === 'createLink' &&
        (job.op.body.from === id || job.op.body.to === id)
      if (job.op.type === 'bulkMove' && mine) {
        this.shrinkBulk(job, entry => entry.id !== id)
        continue
      }
      if (mine || dependent) {
        if (dependent && job.op.type === 'createLink')
          droppedLinks.push(job.op.id)
        this.drop(job, 'skipped')
      }
    }
    this.pump()
    return droppedLinks
  }

  /** "N not saved - retry": everything waiting on backoff goes now. */
  retryAll() {
    for (const job of this.jobs) if (!job.rejected) job.retryAt = 0
    this.pump()
  }

  setOnline(online: boolean) {
    this.online = online
    if (online) this.retryAll()
    else this.emitStatus()
  }

  /** Send every debounced edit now (used before a reload or a backup). */
  flush() {
    for (const job of this.jobs) job.notBefore = 0
    this.pump()
  }

  /**
   * The board page unmounted. Debounced edits go out now and writes waiting on those still
   * follow as they land, but no timer is set again, so nothing retries forever in a tab that
   * has moved on. Leaving with failed writes asks first (TopBar), so this loses nothing
   * silently. `start` undoes it - React's dev double-mount stops and starts every effect.
   */
  stop() {
    this.stopped = true
    this.flush()
  }

  start() {
    this.stopped = false
    this.pump()
  }

  status(): QueueStatus {
    const live = this.jobs.filter(job => !job.rejected)
    return {
      pending: live.length,
      inFlight: live.filter(job => job.inFlight).length,
      failing: live.filter(job => job.attempts > 0 && !job.inFlight).length,
      online: this.online,
    }
  }

  /** Field names with a queued (not yet confirmed) change, for merging a server doc. */
  pendingFields(id: string): Set<string> {
    const fields = new Set<string>(
      Object.keys(this.rejectedPatches.get(id) ?? {})
    )
    for (const job of this.jobs) {
      if (job.op.type === 'patchItem' && job.op.id === id)
        for (const key of Object.keys(job.op.patch)) fields.add(key)
      if (job.op.type === 'createItem' && job.op.id === id)
        for (const key of Object.keys(job.op.body)) fields.add(key)
      if (
        job.op.type === 'bulkMove' &&
        job.op.entries.some(entry => entry.id === id)
      )
        for (const key of ['x', 'y', 'parentId']) fields.add(key)
    }
    return fields
  }

  // MARK: Internals

  private push(
    op: SaveOp,
    keys: string[],
    deps: string[],
    delay: number,
    force = false
  ): Job | null {
    if (!force && keys.some(key => this.deleted.has(key.split(':')[1])))
      return null
    const job: Job = {
      seq: ++this.seq,
      op,
      keys,
      deps: new Set(deps),
      notBefore: this.now() + delay,
      attempts: 0,
      retryAt: 0,
      inFlight: false,
      sent: false,
      rejected: false,
      groups: new Set(),
    }
    this.jobs.push(job)
    this.pump()
    return job
  }

  private tailOf(key: string): Job | undefined {
    for (let i = this.jobs.length - 1; i >= 0; i--)
      if (this.jobs[i].keys.includes(key)) return this.jobs[i]
    return undefined
  }

  private isHead(job: Job): boolean {
    for (const key of job.keys) {
      const head = this.jobs.find(j => j.keys.includes(key))
      if (head !== job) return false
    }
    return true
  }

  private runnable(job: Job, now: number): boolean {
    if (job.inFlight || job.rejected) return false
    if (now < job.notBefore || now < job.retryAt) return false
    for (const dep of job.deps) if (!this.persisted.has(dep)) return false
    // A frame's DELETE waits for writes in flight that name it as a parent: landing after
    // the delete, they would 400 on a parent that no longer exists (`unparent` follows up).
    const { op } = job
    if (
      op.type === 'deleteItem' &&
      this.jobs.some(j => j !== job && j.inFlight && j.deps.has(op.id))
    )
      return false
    return this.isHead(job)
  }

  private pump() {
    if (this.online) {
      const now = this.now()
      for (const job of [...this.jobs])
        if (this.runnable(job, now)) void this.run(job)
    }
    this.schedule()
    this.emitStatus()
  }

  private schedule() {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    if (!this.online || this.stopped) return
    const now = this.now()
    let next = Infinity
    for (const job of this.jobs) {
      if (job.inFlight || job.rejected) continue
      const at = Math.max(job.notBefore, job.retryAt)
      if (at > now) next = Math.min(next, at)
    }
    if (next !== Infinity)
      this.timer = this.setTimer(() => {
        this.timer = null
        this.pump()
      }, next - now)
  }

  private async run(job: Job) {
    job.inFlight = true
    job.sent = true
    const op = job.op
    let result: SendResult
    try {
      result = await this.send(op)
    } catch (error) {
      result = {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
    job.inFlight = false

    if (result.ok) this.onSuccess(job, result.data)
    else this.onFailure(job, result)
    this.pump()
  }

  private onSuccess(job: Job, data: unknown) {
    const { op } = job
    this.remove(job)
    if (op.type === 'createItem') this.persisted.add(op.id)
    if (op.type === 'deleteItem') this.persisted.delete(op.id)
    this.events.onSaved?.(op, data)
    this.settle(job, 'ok')
  }

  private onFailure(job: Job, result: Extract<SendResult, { ok: false }>) {
    const { op } = job
    const transient =
      result.status === 0 ||
      result.status >= 500 ||
      RETRYABLE_4XX.has(result.status)

    // A create that was overtaken by its own delete is not worth retrying.
    if (transient && op.type === 'createItem' && this.deleted.has(op.id)) {
      this.remove(job)
      this.settle(job, 'skipped')
      return
    }

    if (transient) {
      job.attempts += 1
      job.retryAt =
        this.now() +
        BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)]
      return
    }

    // Permanent (4xx).
    if (result.status === 404) {
      if (op.type === 'deleteItem' || op.type === 'deleteLink') {
        this.onSuccess(job, null)
        return
      }
      if (op.type === 'patchItem' || op.type === 'patchLink') {
        this.remove(job)
        this.settle(job, 'failed')
        return
      }
    }

    // A create rejected after its own delete was queued: the server does not have it, and
    // parking it would block that delete forever (it waits behind the create).
    if (
      (op.type === 'createItem' || op.type === 'createLink') &&
      this.deleted.has(op.id)
    ) {
      this.remove(job)
      this.settle(job, 'skipped')
      return
    }

    // A refused delete puts the entity back on the canvas (useBoard), so it is live again.
    if (op.type === 'deleteItem' || op.type === 'deleteLink')
      this.deleted.delete(op.id)

    // Kept whole, `keepChildrenPrivate` included: re-sending a frame un-hide without it
    // would make the children readable (D24).
    if (op.type === 'patchItem')
      this.rejectedPatches.set(op.id, {
        ...this.rejectedPatches.get(op.id),
        ...op.patch,
      })

    if (op.type === 'bulkMove') {
      const named = result.id && op.entries.some(e => e.id === result.id)
      if (named) {
        this.events.onRejected?.(op, result.id!, result.error)
        this.shrinkBulk(job, entry => entry.id !== result.id)
        job.attempts = 0
        job.retryAt = 0
        return
      }
      this.remove(job)
      for (const entry of op.entries)
        this.events.onRejected?.(op, entry.id, result.error)
      this.settle(job, 'failed')
      return
    }

    const entityId = op.type === 'createLink' ? op.id : 'id' in op ? op.id : ''
    if (op.type === 'createItem' || op.type === 'createLink') {
      job.rejected = true
      job.attempts = 0
    } else this.remove(job)
    this.events.onRejected?.(op, entityId, result.error)
    this.settle(job, 'failed')
  }

  private shrinkBulk(job: Job, keep: (entry: BulkPositionUpdate) => boolean) {
    if (job.op.type !== 'bulkMove') return
    const entries = job.op.entries.filter(keep)
    if (entries.length === 0) {
      this.remove(job)
      return
    }
    job.op = { type: 'bulkMove', entries }
    job.keys = entries.map(entry => itemKey(entry.id))
  }

  private drop(job: Job, outcome: 'skipped' | 'failed') {
    this.remove(job)
    this.settle(job, outcome)
  }

  private remove(job: Job) {
    this.jobs = this.jobs.filter(j => j !== job)
  }

  private joinGroup(job: Job, groupId: string, id: string) {
    const group = this.groups.get(groupId)
    if (!group) return
    group.ids.add(id)
    job.groups.add(groupId)
  }

  private settle(job: Job, outcome: 'ok' | 'failed' | 'skipped') {
    const id =
      job.op.type === 'bulkMove'
        ? null
        : job.op.type === 'createLink'
          ? job.op.id
          : job.op.id
    for (const groupId of job.groups) {
      const group = this.groups.get(groupId)
      if (!group || !id) continue
      group.result[outcome].push(id)
      group.ids.delete(id)
      this.settleGroupIfDone(groupId)
    }
  }

  private settleGroupIfDone(groupId: string) {
    const group = this.groups.get(groupId)
    if (!group || !group.closed || group.ids.size > 0) return
    const stillQueued = this.jobs.some(job => job.groups.has(groupId))
    if (stillQueued) return
    this.groups.delete(groupId)
    this.events.onGroupSettled?.(groupId, group.result)
  }

  private emitStatus() {
    this.events.onStatus?.(this.status())
  }
}
