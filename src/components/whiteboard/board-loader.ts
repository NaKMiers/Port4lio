import type { BoardLine } from '@/lib/whiteboard/types'

/**
 * Read the NDJSON board stream, handing parsed lines over in batches (D28, DR4).
 *
 * ```
 *   reader.read() chunk ──▶ split on \n (keep the partial tail) ──▶ onBatch(lines)
 *                                                         one state update per chunk,
 *                                                         not one render per line
 *   stream ends ──▶ saw {"t":"end"}? ── yes ──▶ resolve
 *                                    └─ no ───▶ throw: the board is partial
 * ```
 *
 * A stream cut mid-way is an ERROR, never a smaller board. The canvas autosaves, so a
 * partial board that became editable could quietly save over the real one (DR4).
 */

export class BoardLoadError extends Error {}

export async function readBoardStream(
  body: ReadableStream<Uint8Array>,
  onBatch: (lines: BoardLine[]) => void
): Promise<{ items: number; links: number }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let end: { items: number; links: number } | null = null

  const parse = (raw: string): BoardLine[] => {
    const lines: BoardLine[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let parsed: BoardLine
      try {
        parsed = JSON.parse(line) as BoardLine
      } catch {
        throw new BoardLoadError('The board stream was malformed.')
      }
      if (parsed.t === 'end') end = { items: parsed.items, links: parsed.links }
      lines.push(parsed)
    }
    return lines
  }

  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      throw new BoardLoadError('The board stream was cut off.')
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const cut = buffer.lastIndexOf('\n')
    if (cut === -1) continue
    const complete = buffer.slice(0, cut)
    buffer = buffer.slice(cut + 1)
    const lines = parse(complete)
    if (lines.length) onBatch(lines)
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    const lines = parse(buffer)
    if (lines.length) onBatch(lines)
  }

  if (!end) throw new BoardLoadError('The board stream ended early.')
  return end
}
