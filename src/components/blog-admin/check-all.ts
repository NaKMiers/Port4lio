/**
 * The board's "Check all": inspect every published post, one at a time.
 *
 * ```
 *   for each id ──▶ checkOne(id)
 *                     ok ─────────────────────────────▶ checked += 1
 *                     upstream / not_found / other ───▶ failed += 1, keep going
 *                     unconfigured / bad_config /
 *                     auth / forbidden / quota ───────▶ stop, say why
 * ```
 *
 * ## Why some errors stop the loop and others do not
 *
 * A bad key, a missing permission or an exhausted quota fails the same way on every row, so
 * carrying on would spend the rest of the list - and the 2,000-a-day inspection quota - on
 * calls that cannot succeed. A timeout or a post archived in another tab is about one row, so
 * the loop counts it and moves on rather than leaving the rest of the board unchecked.
 *
 * One request at a time from the browser, not a batch endpoint: each call is short, the board
 * can show progress, and no single serverless invocation has to outlive a long list.
 */

export const STOP_CODES: ReadonlySet<string> = new Set([
  'unconfigured',
  'bad_config',
  'auth',
  'forbidden',
  'quota',
])

export type CheckOutcome =
  { ok: true } | { ok: false; code: string; message: string }

export type CheckAllResult = {
  total: number
  checked: number
  failed: number
  stopped: { code: string; message: string } | null
}

export async function runCheckAll(
  ids: string[],
  checkOne: (id: string) => Promise<CheckOutcome>,
  onProgress: (done: number, total: number) => void
): Promise<CheckAllResult> {
  const result: CheckAllResult = {
    total: ids.length,
    checked: 0,
    failed: 0,
    stopped: null,
  }

  for (const [index, id] of ids.entries()) {
    const outcome = await checkOne(id)
    if (outcome.ok) result.checked += 1
    else {
      result.failed += 1
      if (STOP_CODES.has(outcome.code)) {
        result.stopped = { code: outcome.code, message: outcome.message }
        onProgress(index + 1, ids.length)
        break
      }
    }
    onProgress(index + 1, ids.length)
  }

  return result
}

export function describeCheckAll(result: CheckAllResult): string {
  const counts = `${result.checked} checked, ${result.failed} failed`
  return result.stopped
    ? `Stopped: ${result.stopped.message} (${counts})`
    : counts
}
