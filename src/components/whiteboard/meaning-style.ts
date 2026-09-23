import {
  Moon,
  PenLine,
  StickyNote,
  Target,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

import type { Meaning } from '@/lib/whiteboard/limits'

/**
 * The only place meaning colours live (DR7): the card chip, the inspector options, the export
 * filter chips and the multi-select summary all read this map.
 *
 * Meaning is the board's only colour channel, on purpose - there are no per-card colours - so
 * the colour always says something. Chip text is always the label, never colour alone, and
 * uses the `pp-ink-*` family, which clears 4.5:1 on `pp-bg` (see globals.css).
 */
export interface MeaningStyle {
  label: string
  Icon: LucideIcon | null
  chipCls: string
}

export const MEANING_STYLE: Record<Meaning | 'none', MeaningStyle> = {
  goal: {
    label: 'Goal',
    Icon: Target,
    chipCls: 'text-pp-ink-blue bg-pp-blue/10 border-pp-blue/30',
  },
  dream: {
    label: 'Dream',
    Icon: Moon,
    chipCls: 'text-pp-ink-violet bg-pp-violet/10 border-pp-violet/30',
  },
  failure: {
    label: 'Failure',
    Icon: TriangleAlert,
    chipCls: 'text-pp-ink-amber bg-pp-orange/10 border-pp-orange/30',
  },
  draft: {
    label: 'Draft',
    Icon: PenLine,
    chipCls: 'text-pp-ink-rose bg-pp-pink/10 border-pp-pink/30',
  },
  note: {
    label: 'Note',
    Icon: StickyNote,
    chipCls: 'text-pp-ink-green bg-pp-green/10 border-pp-green/30',
  },
  none: {
    label: 'Unclassified',
    Icon: null,
    chipCls: 'text-pp-muted bg-pp-text/5 border-pp-line',
  },
}

export const meaningStyle = (meaning: Meaning | null) =>
  MEANING_STYLE[meaning ?? 'none']
