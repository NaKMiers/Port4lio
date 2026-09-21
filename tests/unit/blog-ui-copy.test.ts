import { describe, expect, it } from 'vitest'

import { BLOG_COPY, POST_LANGUAGE_LABEL } from '@/lib/blog/ui-copy'
import { LOCALES } from '@/lib/i18n'
import { PostModel } from '@/models/Post'

/**
 * The blog's chrome copy, and the two things its type cannot hold.
 *
 * `BLOG_COPY` is a flat `Record<Locale, BlogCopy>`, which is a deliberate shape: TypeScript
 * fails the build when a locale is missing a key, so half-translated chrome is already
 * unrepresentable. That covers the failure everybody expects from an i18n layer, and it leaves
 * two that compile perfectly:
 *
 * ```
 *   vi: { startHere: '' }              ← a key that is present and blank
 *   vi: { startHere: 'Start here' }    ← a key that was never translated
 * ```
 *
 * Both render. The first renders a button with no label, the second renders English inside
 * Vietnamese chrome, and neither raises anything. A Vietnamese reader is the default audience
 * now, so the second one is the expensive case: it is the tell that the Vietnamese version is
 * an afterthought, on the surface that exists to say it is not.
 *
 * The third describe block is about a different file's invariant leaking into this one -
 * `POST_LANGUAGE_LABEL` is typed `Record<string, string>`, which is wide enough to be missing
 * the language a post is actually stored with.
 */

/** Every key on `BlogCopy`, read off the English entry rather than written out twice. */
const KEYS = Object.keys(BLOG_COPY.en) as (keyof typeof BLOG_COPY.en)[]

/**
 * Keys whose two locales are ALLOWED to be identical, with the reason.
 *
 * Kept as a named list rather than loosening the assertion: an untranslated string is the
 * failure being tested for, so every exemption has to be argued for once, here.
 */
const SAME_IN_BOTH_LOCALES = new Set<keyof typeof BLOG_COPY.en>([
  // "Blog" is the word Vietnamese developers use. "Nhật ký" would be a translation nobody asked
  // for, of the one string on the page that is already understood.
  'eyebrow',
])

describe('both locales are complete', () => {
  it('carries every key in every locale', () => {
    for (const locale of LOCALES)
      expect(Object.keys(BLOG_COPY[locale]).sort()).toEqual([...KEYS].sort())
  })

  it('has no blank string anywhere', () => {
    // A blank renders as a button with no label or a heading with no text. Nothing throws.
    for (const locale of LOCALES)
      for (const key of KEYS) {
        const value = BLOG_COPY[locale][key]
        if (typeof value === 'string') expect(value.trim()).not.toBe('')
      }
  })

  it('leaves nothing sitting in English inside the Vietnamese chrome', () => {
    // The failure this file exists for. Vietnamese is the default language of the blog now, so
    // untranslated furniture is not a rough edge, it is the thing a Vietnamese reader notices
    // first about a site claiming to be written for them.
    const untranslated = KEYS.filter(key => {
      if (SAME_IN_BOTH_LOCALES.has(key)) return false
      const en = BLOG_COPY.en[key]
      const vi = BLOG_COPY.vi[key]
      if (typeof en !== 'string' || typeof vi !== 'string') return false
      return en === vi
    })

    expect(untranslated).toEqual([])
  })
})

describe('the copy that is a function', () => {
  it('interpolates the count rather than dropping it', () => {
    // `postsCountMany(0)` never happens - the empty case has its own string - so the interesting
    // values are the ones either side of the singular.
    for (const locale of LOCALES) {
      expect(BLOG_COPY[locale].postsCountMany(7)).toContain('7')
      expect(BLOG_COPY[locale].resultsMany(12)).toContain('12')
    }
  })

  it('quotes the reader query back to them in the no-match message', () => {
    for (const locale of LOCALES)
      expect(BLOG_COPY[locale].noMatchBody('revalidate')).toContain(
        'revalidate'
      )
  })

  it('says what the search does NOT cover, in both locales', () => {
    /*
      Load-bearing rather than pedantic. The index search is a `filter` over titles, tags and
      series - it deliberately does not touch the body, because the body is not on the client
      and shipping every post's markdown to make a short list searchable is the wrong trade.

      A reader who searches for a phrase they remember from inside a post gets "No matches" and
      concludes the post is gone. This sentence is the only thing that prevents that, so it has
      to survive a copy edit in both languages.
    */
    expect(BLOG_COPY.en.noMatchBody('x')).toContain(
      'not the text inside a post'
    )
    expect(BLOG_COPY.vi.noMatchBody('x')).toContain('không tìm trong nội dung')
  })

  it('never returns a blank from a copy function', () => {
    for (const locale of LOCALES) {
      expect(BLOG_COPY[locale].postsCountMany(3).trim()).not.toBe('')
      expect(BLOG_COPY[locale].resultsMany(3).trim()).not.toBe('')
      expect(BLOG_COPY[locale].noMatchBody('q').trim()).not.toBe('')
    }
  })
})

describe('POST_LANGUAGE_LABEL vs what a post can actually be stored as', () => {
  it('has a label for every language the schema allows', () => {
    /*
      The same shape of relationship `CODE_LANGUAGE_OPTIONS` has with Shiki's grammar list, and
      the same reason to pin it in a test: `POST_LANGUAGE_LABEL` is `Record<string, string>`, so
      a language the schema accepts and this map has never heard of is not a type error. It is a
      card that renders `undefined` as its language badge.

      Read off the schema rather than written out, so adding a third language to the enum fails
      here rather than in production.
    */
    const allowed =
      // `enumValues` is the runtime list mongoose validates against, which is the actual
      // question - not what the TypeScript union happens to say.
      PostModel.schema.path('language').options.enum as string[]

    expect(allowed.length).toBeGreaterThan(0)
    for (const language of allowed)
      expect(POST_LANGUAGE_LABEL[language]).toBeTruthy()
  })

  it('labels each language in that language, not in the readerial one', () => {
    // The badge exists to warn a reader that a post is in a language they may not read, so it
    // has to be legible to somebody who does not read the chrome language.
    expect(POST_LANGUAGE_LABEL.vi).toBe('Tiếng Việt')
    expect(POST_LANGUAGE_LABEL.en).toBe('English')
  })
})
