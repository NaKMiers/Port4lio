import type { TypeGroup } from '@/lib/mbti/types'

/**
 * One editorial accent per temperament group.
 *
 * These are the portfolio's own `--pp-*` accents, not a new MBTI palette: the four groups
 * happen to need exactly four colours, and reusing the existing ones keeps this section
 * looking like the rest of the site. Written as full class strings rather than composed
 * from a `pp-${group}` template because Tailwind scans source text - an interpolated class
 * name is a class name that never reaches the stylesheet.
 */
export const GROUP_ACCENT: Record<
  TypeGroup,
  { dot: string; chip: string; rule: string; text: string }
> = {
  NT: {
    dot: 'bg-pp-violet',
    chip: 'border-[rgba(123,109,255,0.28)] bg-[rgba(123,109,255,0.08)]',
    rule: 'bg-[linear-gradient(90deg,rgba(123,109,255,0.65),transparent)]',
    text: 'text-[#5b4fd8]',
  },
  NF: {
    dot: 'bg-pp-pink',
    chip: 'border-[rgba(243,143,209,0.3)] bg-[rgba(243,143,209,0.08)]',
    rule: 'bg-[linear-gradient(90deg,rgba(243,143,209,0.65),transparent)]',
    text: 'text-[#c4589f]',
  },
  SJ: {
    dot: 'bg-pp-blue',
    chip: 'border-[rgba(51,152,255,0.28)] bg-[rgba(51,152,255,0.08)]',
    rule: 'bg-[linear-gradient(90deg,rgba(51,152,255,0.65),transparent)]',
    text: 'text-[#1f7ad6]',
  },
  SP: {
    dot: 'bg-pp-green',
    chip: 'border-[rgba(57,190,113,0.28)] bg-[rgba(57,190,113,0.08)]',
    rule: 'bg-[linear-gradient(90deg,rgba(57,190,113,0.65),transparent)]',
    text: 'text-[#2b9459]',
  },
}
