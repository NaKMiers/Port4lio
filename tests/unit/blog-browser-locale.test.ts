import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserLocale } from '@/lib/blog/browser-locale'

/**
 * The blog's default chrome language, for a reader who has not used the VI/EN toggle.
 *
 * `navigator.languages` is in preference order, so the first supported base language wins -
 * and a browser listing only unsupported languages gets `null`, which the provider turns into
 * its English default.
 */

function withLanguages(languages: string[], language = languages[0] ?? '') {
  vi.stubGlobal('navigator', { languages, language })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browserLocale', () => {
  it('picks Vietnamese for a vi-VN browser', () => {
    withLanguages(['vi-VN', 'vi', 'en-US'])
    expect(browserLocale()).toBe('vi')
  })

  it('picks English for an en-US browser, even if Vietnamese is listed later', () => {
    withLanguages(['en-US', 'vi'])
    expect(browserLocale()).toBe('en')
  })

  it('skips unsupported languages to reach the first supported one', () => {
    withLanguages(['fr-FR', 'ja', 'vi'])
    expect(browserLocale()).toBe('vi')
  })

  it('returns null when nothing listed is supported', () => {
    withLanguages(['fr-FR', 'de'])
    expect(browserLocale()).toBeNull()
  })

  it('falls back to navigator.language when navigator.languages is empty', () => {
    withLanguages([], 'vi')
    expect(browserLocale()).toBe('vi')
  })
})
