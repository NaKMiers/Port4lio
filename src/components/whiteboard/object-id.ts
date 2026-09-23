/**
 * A 24-hex ObjectId generated in the browser, so a card has its real id the moment it is
 * drawn (see save-queue.ts). Same layout as BSON's: 4-byte seconds, 5 random bytes, a 3-byte
 * counter - which keeps new ids roughly time-ordered like server-made ones.
 */
let counter = Math.floor(Math.random() * 0xffffff)
let random: string | null = null

const hex = (n: number, bytes: number) =>
  n
    .toString(16)
    .padStart(bytes * 2, '0')
    .slice(-bytes * 2)

export function newObjectId(now = Date.now()): string {
  if (!random) {
    const bytes = new Uint8Array(5)
    crypto.getRandomValues(bytes)
    random = [...bytes].map(b => hex(b, 1)).join('')
  }
  counter = (counter + 1) % 0xffffff
  return hex(Math.floor(now / 1000), 4) + random + hex(counter, 3)
}
