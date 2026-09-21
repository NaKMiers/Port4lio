'use client'

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from 'react'

import { BLOG_COPY, type BlogCopy } from '@/lib/blog/ui-copy'
import { isLocale, type Locale } from '@/lib/i18n'

const STORAGE_KEY = 'blog:locale'

/**
 * The reader's preferred language for blog CHROME, remembered across visits.
 *
 * ```
 *   server render  ->  always 'en'   ->  matches the HTML a crawler and a first-time
 *                                        visitor get, and matches `<html lang='en'>`
 *   after hydration ->  localStorage ->  swaps the furniture if a preference is stored
 * ```
 *
 * ## Why this is not in the URL, unlike MBTI and IQ
 *
 * Those live under `(choice)/[lang]/`, so `swapLocale(pathname, locale)` is a real navigation
 * to a real page. The blog does not and must not: `/blog/<slug>` URLs are indexed, and they
 * are cross-posted to DEV and Viblo with `rel=canonical` pointing back here. Moving them
 * under a locale segment breaks every one of those, and a `?lang=` query would opt the index
 * and every post out of static rendering by reading `searchParams`.
 *
 * The usual argument against a stored preference - that the language is then not crawlable or
 * shareable - does not apply here, and that is the whole reason this shape is acceptable. The
 * POSTS are not translated. Only the furniture is. There is no Vietnamese version of the
 * content for a crawler to index or for a reader to share, so a Vietnamese URL would promise
 * something that does not exist.
 *
 * ## Why the first paint is always English
 *
 * Reading `localStorage` during render would mismatch the server's HTML and React would throw
 * out the whole subtree. So the default renders, then an effect applies the stored choice.
 * A reader who picked Vietnamese sees English furniture for one frame. That is the entire
 * cost, it is paid once per page load, and the alternative is a cookie read that would make
 * every blog page dynamic.
 */

type BlogLocaleValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  copy: BlogCopy
  /** False until the stored preference has been applied - lets the toggle avoid flickering. */
  ready: boolean
}

const BlogLocaleContext = createContext<BlogLocaleValue | null>(null)

export default function BlogLocaleProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // NOT `DEFAULT_LOCALE`, which is `vi` for the test products. The blog's posts are English
  // (D7), so English furniture around them is the honest default for a reader with no
  // preference stored - and it is what the server rendered.
  const [locale, setLocaleState] = useState<Locale>('en')
  const [ready, setReady] = useState(false)

  const applyStored = useEffectEvent(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (isLocale(stored ?? undefined)) setLocaleState(stored as Locale)
    } catch {
      // Private mode or storage disabled. English furniture is a fine outcome.
    }
    setReady(true)
  })

  // Deferred to a macrotask so the `setState` does not run inside the effect body, matching
  // `BlogEditor`, `BlogBoard` and `AppProvider`. The rule it satisfies is not a formality: a
  // setState in an effect body cascades a second render before paint.
  useEffect(() => {
    const timer = window.setTimeout(() => applyStored(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const setLocale = (next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // The choice still applies to this page; it just will not survive a reload.
    }
  }

  return (
    <BlogLocaleContext.Provider
      value={{ locale, setLocale, copy: BLOG_COPY[locale], ready }}
    >
      {children}
    </BlogLocaleContext.Provider>
  )
}

/**
 * Falls back to English outside a provider rather than throwing.
 *
 * `PostCard` is rendered both inside `BlogIndexList` (which is under the provider) and
 * potentially from a server component elsewhere - `WritingTeaser` renders one on the
 * portfolio home page, which has no blog provider above it. A hook that threw would turn a
 * missing provider into a 500 on the home page.
 */
export function useBlogLocale(): BlogLocaleValue {
  return (
    useContext(BlogLocaleContext) ?? {
      locale: 'en',
      setLocale: () => {},
      copy: BLOG_COPY.en,
      ready: true,
    }
  )
}
