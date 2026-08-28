import crypto from 'node:crypto'

import type { PublishTargetId } from './types'

/**
 * Deterministic JSON: object keys sorted, array order preserved, `undefined` dropped.
 *
 * Sorting keys is the point. `POST /api/profile` writes with `$set: { ...parsed }`, which
 * rewrites the document, and BSON preserves insertion order - so re-saving semantically
 * identical content can produce a different key order. Hashing raw `JSON.stringify`
 * output would report phantom drift on every such save.
 *
 * Array order is NOT sorted: reordering projects or skills is a real content change.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Hash of a rendered artifact.
 *
 * Deliberately taken over the OUTPUT, not the source fields: what matters is whether the
 * text you would paste changed. Editing `backgroundImage` must not mark LinkedIn stale,
 * and improving a renderer genuinely does make last month's paste out of date.
 */
export function hashArtifact(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

/** Whole-manifest version: per-target hashes combined in a fixed target order. */
export function combineVersions(
  perTarget: Record<string, string>,
  order: readonly PublishTargetId[]
): string {
  return crypto
    .createHash('sha256')
    .update(
      order.map(id => `${id}:${perTarget[id] ?? ''}`).join('|'),
      'utf8'
    )
    .digest('hex')
}
