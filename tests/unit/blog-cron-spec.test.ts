import { describe, expect, it } from 'vitest'

import {
  avoidInstruction,
  CRON_ANGLES,
  RECENT_TITLE_LIMIT,
  sampleCronSpec,
} from '@/lib/blog/cron-spec'
import {
  normaliseSpec,
  NO_SERIES,
  type GenerationFieldKey,
} from '@/lib/blog/generation-fields'

/**
 * The daily sampler.
 *
 * The test that earns its place is the first one: every value in `CRON_ANGLES` is a bare
 * string that has to exist in an option list in `generation-fields.ts`, and TypeScript checks
 * none of it. A typo there is not a crash - `normaliseSpec` drops the field back to auto and
 * the post is generated without the instruction the table thought it gave, silently, every day.
 */

const KINDS = ['article', 'note']
const SERIES = ['measured-in-production', 'dev-career-vn']

/** A generator that walks 0, 0.1, 0.2 ... so a test can step through the tables. */
function ramp(start = 0, step = 0.1): () => number {
  let value = start
  return () => {
    const current = value % 1
    value += step
    return current
  }
}

describe('every angle is expressible as a real spec', () => {
  it.each(CRON_ANGLES.map(angle => [angle.key, angle] as const))(
    '%s survives normaliseSpec with nothing dropped',
    (_key, angle) => {
      const spec = Object.fromEntries(
        Object.entries(angle.fields).map(([field, value]) => [
          field,
          { mode: 'manual', value },
        ])
      )

      const { dropped } = normaliseSpec(spec)

      expect(dropped).toEqual([])
    }
  )

  it.each(CRON_ANGLES.map(angle => [angle.key, angle] as const))(
    '%s keeps every field it set',
    (_key, angle) => {
      const spec = Object.fromEntries(
        Object.entries(angle.fields).map(([field, value]) => [
          field,
          { mode: 'manual', value },
        ])
      )

      const normalised = normaliseSpec(spec).spec

      for (const [field, value] of Object.entries(angle.fields)) {
        const entry = normalised[field as GenerationFieldKey]
        expect(entry.mode, `${_key}.${field} fell back to auto`).toBe('manual')
        expect(entry.value).toEqual(value)
      }
    }
  )

  it('never samples a pillar, in length or in isPillar', () => {
    // A series may hold exactly one pillar - the database enforces it with a partial unique
    // index - so a dice roll that spends that slot is unrecoverable without a manual edit.
    for (const angle of CRON_ANGLES) {
      expect(angle.fields.length).not.toBe('pillar')
      expect(angle.fields.structure).not.toBe('pillar-hub')
      expect(angle.fields.isPillar).toBeUndefined()
    }
  })
})

describe('sampleCronSpec', () => {
  const input = { kinds: KINDS, series: SERIES, recentTitles: [] }

  it('produces a spec whose entries are all manual', () => {
    const { spec } = sampleCronSpec({ ...input, random: ramp() })

    for (const entry of Object.values(spec)) expect(entry?.mode).toBe('manual')
  })

  it('produces a spec the route accepts whole', () => {
    // The end-to-end version of the per-angle test above, with the jitter and the kind and
    // series picks included.
    for (let seed = 0; seed < 40; seed += 1) {
      const { spec } = sampleCronSpec({
        ...input,
        random: ramp(seed / 40, 0.07),
      })
      expect(normaliseSpec(spec).dropped).toEqual([])
    }
  })

  it('reports which angle it drew', () => {
    const { angle } = sampleCronSpec({ ...input, random: () => 0 })

    expect(angle).toBe(CRON_ANGLES[0].key)
  })

  it('only ever picks a kind that exists', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const { spec } = sampleCronSpec({ ...input, random: ramp(seed / 50) })
      expect(KINDS).toContain(spec.kind?.value)
    }
  })

  it('files under a real series or under none, never anything else', () => {
    const seen = new Set<unknown>()
    for (let seed = 0; seed < 50; seed += 1) {
      const { spec } = sampleCronSpec({ ...input, random: ramp(seed / 50) })
      seen.add(spec.series?.value)
    }

    for (const value of seen)
      expect([...SERIES, NO_SERIES]).toContain(value as string)
  })

  it('falls back to no series when the collection is empty', () => {
    const { spec } = sampleCronSpec({
      kinds: KINDS,
      series: [],
      recentTitles: [],
      random: () => 0,
    })

    expect(spec.series?.value).toBe(NO_SERIES)
  })

  it('leaves kind on auto when no kinds exist rather than inventing one', () => {
    const { spec } = sampleCronSpec({
      kinds: [],
      series: [],
      recentTitles: [],
      random: () => 0,
    })

    expect(spec.kind).toBeUndefined()
  })

  it('does not overwrite a tone the angle chose on purpose', () => {
    // `postmortem` is blunt because a postmortem is blunt. Jitter that reached it would undo
    // the coherence the bundles exist for.
    for (let seed = 0; seed < 60; seed += 1) {
      const { spec, angle } = sampleCronSpec({
        ...input,
        random: ramp(seed / 60),
      })
      const chosen = CRON_ANGLES.find(entry => entry.key === angle)
      if (chosen?.fields.tone) expect(spec.tone?.value).toBe(chosen.fields.tone)
    }
  })

  it('survives a random() that returns exactly 1', () => {
    // `Math.random` never does. An injected one can, and an unclamped weighted pick then
    // returns undefined - which surfaces later as a spec with no style, not as a failure here.
    const { spec, angle } = sampleCronSpec({ ...input, random: () => 1 })

    expect(angle).toBeTruthy()
    expect(spec.style?.value).toBeTruthy()
  })

  it('varies across calls rather than writing the same post every day', () => {
    // The whole point of the feature. Against the real RNG, because a stubbed one would be
    // testing the stub.
    const angles = new Set<string>()
    for (let n = 0; n < 300; n += 1) angles.add(sampleCronSpec(input).angle)

    expect(angles.size).toBeGreaterThan(6)
  })

  it('weights notes above any single article angle', () => {
    // `docs/blog/authoring.md` commits to 8 notes per 2 articles, and a daily job is the
    // thing most able to honour that and most likely to drift off it.
    const counts = new Map<string, number>()
    for (let n = 0; n < 4000; n += 1) {
      const { angle } = sampleCronSpec(input)
      counts.set(angle, (counts.get(angle) ?? 0) + 1)
    }

    const notes = [...counts.entries()]
      .filter(([key]) => key.startsWith('note-'))
      .reduce((sum, [, count]) => sum + count, 0)

    expect(notes / 4000).toBeGreaterThan(0.4)
  })
})

describe('avoidInstruction', () => {
  it('is empty with no history, so the first run sends no instruction', () => {
    expect(avoidInstruction([])).toBe('')
    expect(avoidInstruction(['  ', ''])).toBe('')
  })

  it('names every title it was given', () => {
    const text = avoidInstruction(['Five things', 'revalidateTag did nothing'])

    expect(text).toContain('- Five things')
    expect(text).toContain('- revalidateTag did nothing')
  })

  it('asks for a different subject rather than banning words', () => {
    const text = avoidInstruction(['Five things'])

    expect(text).toContain('Write about something none of them covers')
  })

  it('caps the list so it cannot grow into the prompt budget', () => {
    const titles = Array.from({ length: 80 }, (_, n) => `Post ${n}`)
    const lines = avoidInstruction(titles)
      .split('\n')
      .filter(line => line.startsWith('- '))

    expect(lines).toHaveLength(RECENT_TITLE_LIMIT)
  })

  it('reaches the model intact - it fits the instruction field', () => {
    // `instruction` is capped at 4000 chars by `normaliseSpec`, which TRUNCATES rather than
    // rejects. A list that overran would be cut mid-title, and the model would be told to
    // avoid a post whose name it cannot see.
    const titles = Array.from({ length: RECENT_TITLE_LIMIT }, () =>
      'x'.repeat(120)
    )
    const { spec } = sampleCronSpec({
      kinds: KINDS,
      series: SERIES,
      recentTitles: titles,
      random: () => 0,
    })

    const normalised = normaliseSpec(spec).spec.instruction
    expect(normalised.value).toBe(spec.instruction?.value)
  })
})
