import { isDayParam } from '@/lib/whiteboard/context'
import {
  LIMITS,
  MEANINGS,
  STATUSES,
  isObjectIdString,
  type Meaning,
  type Status,
} from '@/lib/whiteboard/limits'
import type { ExportScope } from '@/lib/whiteboard/types'

/**
 * Parse the export scope of `POST /api/admin/whiteboard/context` at the boundary.
 *
 * Dates are `YYYY-MM-DD` and nothing else (D22): an agent-friendly ISO instant would bring
 * the timezone question back in through the side door. A malformed frame id is not an error
 * here - `loadAgentVisible` answers it with the same empty export as an unknown id.
 */
export function parseExportScope(
  input: unknown
): { ok: true; value: ExportScope } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>

  switch (raw.kind) {
    case 'all':
      return { ok: true, value: { kind: 'all' } }
    case 'frame':
      if (typeof raw.id !== 'string')
        return { ok: false, error: 'scope.id must be a string.' }
      return { ok: true, value: { kind: 'frame', id: raw.id } }
    case 'selection': {
      if (!Array.isArray(raw.ids))
        return { ok: false, error: 'scope.ids must be an array.' }
      if (raw.ids.length > LIMITS.selectionIds)
        return {
          ok: false,
          error: `scope.ids is over ${LIMITS.selectionIds} entries.`,
        }
      if (!raw.ids.every(isObjectIdString))
        return { ok: false, error: 'scope.ids must be ObjectIds.' }
      return {
        ok: true,
        value: {
          kind: 'selection',
          ids: raw.ids.map(id => id.toLowerCase()),
        },
      }
    }
    case 'filter': {
      const meanings = raw.meanings ?? []
      const status = raw.status ?? []
      if (
        !Array.isArray(meanings) ||
        !meanings.every(m => MEANINGS.includes(m as Meaning))
      )
        return { ok: false, error: 'scope.meanings has an unknown meaning.' }
      if (
        !Array.isArray(status) ||
        !status.every(s => STATUSES.includes(s as Status))
      )
        return { ok: false, error: 'scope.status has an unknown status.' }
      const days: Record<string, string | undefined> = {}
      for (const key of ['from', 'to', 'targetFrom', 'targetTo'] as const) {
        const value = raw[key]
        if (value === undefined || value === null || value === '') continue
        if (!isDayParam(value))
          return { ok: false, error: `scope.${key} must be YYYY-MM-DD.` }
        days[key] = value
      }
      return {
        ok: true,
        value: {
          kind: 'filter',
          meanings: meanings as Meaning[],
          status: status as Status[],
          ...days,
        },
      }
    }
    default:
      return {
        ok: false,
        error: 'scope.kind must be all, frame, selection or filter.',
      }
  }
}
