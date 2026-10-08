/** Replaces one entry of an array field, leaving the rest untouched. */
export function replaceAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  const next = [...list]
  next[index] = { ...next[index], ...patch }
  return next
}

/** Note shown wherever `**bold**` is accepted, so the syntax is discoverable. */
export const BOLD_HINT = 'Wrap text in **double asterisks** to print it bold.'
