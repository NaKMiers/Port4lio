import {
  Bookmark,
  Flag,
  Heart,
  Lightbulb,
  Moon,
  PenLine,
  Star,
  StickyNote,
  Target,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

import {
  findMeaning,
  type Vocab,
  type VocabIcon,
  type VocabTone,
} from '@/lib/whiteboard/vocab'

/**
 * The only place meaning colours live (DR7): the card chip, the inspector options, the export
 * filter chips and the multi-select summary all read `meaningStyle`.
 *
 * Meaning is the board's only colour channel, on purpose - there are no per-card colours - so
 * the colour always says something. Chip text is always the label, never colour alone, and
 * uses the `pp-ink-*` family, which clears 4.5:1 on `pp-bg` (see globals.css).
 *
 * The meanings themselves are the owner's list (`lib/whiteboard/vocab.ts`); an entry names a
 * tone and an icon from the fixed sets here. Fixed on purpose: the classes have to be literal
 * strings for Tailwind to generate them, and a free colour picker would bring back the
 * per-card colour the board decided against.
 */
export interface MeaningStyle {
  label: string
  Icon: LucideIcon | null
  chipCls: string
}

export const TONE_CLS: Record<VocabTone, string> = {
  blue: 'text-pp-ink-blue bg-pp-blue/10 border-pp-blue/30',
  violet: 'text-pp-ink-violet bg-pp-violet/10 border-pp-violet/30',
  amber: 'text-pp-ink-amber bg-pp-orange/10 border-pp-orange/30',
  rose: 'text-pp-ink-rose bg-pp-pink/10 border-pp-pink/30',
  green: 'text-pp-ink-green bg-pp-green/10 border-pp-green/30',
  slate: 'text-pp-text bg-pp-text/5 border-pp-text/20',
}

export const TONE_LABEL: Record<VocabTone, string> = {
  blue: 'Blue',
  violet: 'Violet',
  amber: 'Amber',
  rose: 'Rose',
  green: 'Green',
  slate: 'Slate',
}

export const ICONS: Record<VocabIcon, LucideIcon> = {
  target: Target,
  moon: Moon,
  alert: TriangleAlert,
  pen: PenLine,
  note: StickyNote,
  star: Star,
  flag: Flag,
  bulb: Lightbulb,
  heart: Heart,
  bookmark: Bookmark,
}

export const UNCLASSIFIED: MeaningStyle = {
  label: 'Unclassified',
  Icon: null,
  chipCls: 'text-pp-muted bg-pp-text/5 border-pp-line',
}

/**
 * A key the list does not have (deleted after a card was given it, or not loaded yet) shows
 * the raw key in the neutral tone - visibly "not one of mine" rather than borrowing a colour.
 */
export function meaningStyle(vocab: Vocab, key: string | null): MeaningStyle {
  if (!key) return UNCLASSIFIED
  const meaning = findMeaning(vocab, key)
  if (!meaning) return { ...UNCLASSIFIED, label: key }
  return {
    label: meaning.label,
    Icon: meaning.icon ? ICONS[meaning.icon] : null,
    chipCls: TONE_CLS[meaning.tone],
  }
}
