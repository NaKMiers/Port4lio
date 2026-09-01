/**
 * The four axes and the sixteen types.
 *
 * Axis order is fixed as E/I, S/N, T/F, J/P because that order *is* the type code: the
 * scorer walks `AXES` and concatenates one letter per axis, so reordering this array
 * silently reorders every type string in the product.
 */

export const AXES = ['EI', 'SN', 'TF', 'JP'] as const

export type Axis = (typeof AXES)[number]

/**
 * Per axis: which letter each side scores.
 *
 * `a` is always the first letter of the axis name. A question's answer `a` scores
 * `AXIS_POLES[axis].a`, answer `b` scores `.b`. Keeping this as data rather than string
 * slicing means the mapping is greppable and testable.
 */
export const AXIS_POLES: Record<Axis, { a: string; b: string }> = {
  EI: { a: 'E', b: 'I' },
  SN: { a: 'S', b: 'N' },
  TF: { a: 'T', b: 'F' },
  JP: { a: 'J', b: 'P' },
}

export const MBTI_TYPES = [
  'ENFJ',
  'ENFP',
  'ENTJ',
  'ENTP',
  'ESFJ',
  'ESFP',
  'ESTJ',
  'ESTP',
  'INFJ',
  'INFP',
  'INTJ',
  'INTP',
  'ISFJ',
  'ISFP',
  'ISTJ',
  'ISTP',
] as const

export type MbtiType = (typeof MBTI_TYPES)[number]

/**
 * The four temperament groups, in the standard Keirsey pairing.
 *
 * Domain rather than decoration: this is the conventional way the sixteen types are
 * grouped, it is how every other test on the market presents them, and it turns a flat
 * list of sixteen codes into four sets of four that someone can actually scan. The UI
 * gives each group a colour, but the grouping itself is not a UI concern.
 */
export const TYPE_GROUPS = ['NT', 'NF', 'SJ', 'SP'] as const

export type TypeGroup = (typeof TYPE_GROUPS)[number]

/**
 * Intuitives are grouped by their T/F letter, sensors by their J/P letter. That asymmetry
 * is the actual convention, not a bug: NT/NF split on how they decide, SJ/SP on how they
 * organise.
 */
export function groupOfType(type: MbtiType): TypeGroup {
  if (type.includes('N')) return type.includes('T') ? 'NT' : 'NF'
  return type.includes('J') ? 'SJ' : 'SP'
}

/** Types belonging to a group, in `MBTI_TYPES` order. */
export function typesInGroup(group: TypeGroup): MbtiType[] {
  return MBTI_TYPES.filter(type => groupOfType(type) === group)
}

export function isMbtiType(value: string | undefined): value is MbtiType {
  return typeof value === 'string' && (MBTI_TYPES as readonly string[]).includes(value.toUpperCase())
}

/** Route segments are lowercase (`/vi/mbti/enfj`); type codes are uppercase everywhere else. */
export function typeFromSlug(slug: string | undefined): MbtiType | null {
  if (typeof slug !== 'string') return null
  const upper = slug.toUpperCase()
  return isMbtiType(upper) ? (upper as MbtiType) : null
}

export function slugFromType(type: MbtiType): string {
  return type.toLowerCase()
}
