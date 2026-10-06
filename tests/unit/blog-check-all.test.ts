import { describe, expect, it, vi } from 'vitest'

import {
  describeCheckAll,
  runCheckAll,
  type CheckOutcome,
} from '@/components/blog-admin/check-all'

/**
 * The board's Check all loop (`components/blog-admin/check-all.ts`).
 *
 * The stop rule is the part with a real cost: an error that will repeat on every row must
 * end the loop at once, or it spends the rest of the list and the daily inspection quota on
 * calls that cannot succeed. A one-row failure must not stop it, or half the board goes
 * unchecked.
 */

const fail = (code: string): CheckOutcome => ({
  ok: false,
  code,
  message: `${code} happened`,
})

describe('runCheckAll', () => {
  it.each(['unconfigured', 'bad_config', 'auth', 'forbidden', 'quota'])(
    '%s stops the loop and says why',
    async code => {
      const checkOne = vi
        .fn<(id: string) => Promise<CheckOutcome>>()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(fail(code))
      const progress = vi.fn()

      const result = await runCheckAll(['a', 'b', 'c', 'd'], checkOne, progress)

      expect(checkOne).toHaveBeenCalledTimes(2)
      expect(result).toEqual({
        total: 4,
        checked: 1,
        failed: 1,
        stopped: { code, message: `${code} happened` },
      })
      expect(progress).toHaveBeenLastCalledWith(2, 4)
      expect(describeCheckAll(result)).toBe(
        `Stopped: ${code} happened (1 checked, 1 failed)`
      )
    }
  )

  it.each(['upstream', 'not_found', 'not_published', 'network', 'error'])(
    '%s counts one failure and keeps going',
    async code => {
      const checkOne = vi
        .fn<(id: string) => Promise<CheckOutcome>>()
        .mockResolvedValueOnce(fail(code))
        .mockResolvedValue({ ok: true })
      const progress = vi.fn()

      const result = await runCheckAll(['a', 'b', 'c'], checkOne, progress)

      expect(checkOne).toHaveBeenCalledTimes(3)
      expect(result).toMatchObject({ checked: 2, failed: 1, stopped: null })
      expect(progress.mock.calls).toEqual([
        [1, 3],
        [2, 3],
        [3, 3],
      ])
      expect(describeCheckAll(result)).toBe('2 checked, 1 failed')
    }
  )

  it('checks posts one at a time, in order', async () => {
    const order: string[] = []
    let inFlight = 0
    const checkOne = async (id: string): Promise<CheckOutcome> => {
      inFlight += 1
      expect(inFlight).toBe(1)
      order.push(id)
      await Promise.resolve()
      inFlight -= 1
      return { ok: true }
    }
    await runCheckAll(['x', 'y', 'z'], checkOne, () => {})
    expect(order).toEqual(['x', 'y', 'z'])
  })
})
