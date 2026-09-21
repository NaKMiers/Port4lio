import { existsSync } from 'node:fs'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import IqPitchLayout from '@/app/(choice)/[lang]/iq/(pitch)/layout'
import IqPlainLayout from '@/app/(choice)/[lang]/iq/(plain)/layout'
import MbtiPitchLayout from '@/app/(choice)/[lang]/mbti/(pitch)/layout'
import MbtiPlainLayout from '@/app/(choice)/[lang]/mbti/(plain)/layout'
import { LOCALES } from '@/lib/i18n'

/**
 * MANDATORY REGRESSION: the availability block does not render on the questionnaires.
 *
 * ```
 *   /[lang]/mbti/test   ← 60 questions
 *   /[lang]/iq/test     ← 24-minute clock
 * ```
 *
 * Interrupting either with a "here is who built this, he is open to work" panel is the
 * specific failure the `(pitch)` / `(plain)` split exists to prevent. The block's call to
 * action navigates *off the site*, so on a test page it is not noise - it is an exit
 * rendered next to the answer buttons, on the page a visitor has invested the most in.
 *
 * ## Why this asserts on layouts AND on where the page files live
 *
 * The rule is enforced by which route group a file sits in, and a directory rename can undo
 * that silently - no type error, no build failure, just a pitch appearing mid-test. The
 * layouts are where the decision is expressed, so they are pinned below.
 *
 * But pinning the layouts does not pin the rename, and the first version of this file
 * claimed it did. Both layouts import by module path, so
 * `git mv mbti/(plain)/test mbti/(pitch)/test` leaves every render assertion here passing,
 * along with typecheck, lint and `next build`, while `/vi/mbti/test` starts serving the
 * block. The layout half of this file is blind to the exact move its own comment named.
 *
 * Hence the filesystem assertions first. They are the only ones that fail on a rename, and
 * they are checked before the render cases so the failure names the cause rather than
 * arriving as four confusing markup diffs.
 *
 * `/[lang]/mbti/(plain)/test/page.tsx` itself renders a client questionnaire with its own
 * data requirements; rendering it here would test the questionnaire, not the placement.
 * What matters is that the shell wrapped around it contributes no block.
 *
 * ## Why both halves are asserted
 *
 * The negative alone is worthless. A test that looks for a string in markup will pass just
 * as happily if the component was deleted, renamed, or never rendered anywhere - so the
 * `(pitch)` cases below prove the probe can actually detect the block, and the `(plain)`
 * cases prove it is absent. Only the pair means anything.
 *
 * Layouts are `async`, so they are awaited as plain functions to get their element tree.
 * `renderToStaticMarkup` cannot render an async component itself. `next/navigation` is
 * mocked because `LocaleSwitcher` calls `usePathname()` - see
 * `test-chrome-footer-slot.test.tsx` for that story.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vi/mbti',
  notFound: () => {
    throw new Error('notFound() called')
  },
}))

/** The marker is the block's own heading id, which `aria-labelledby` makes load-bearing. */
const BLOCK_MARKER = 'availability-heading'

async function renderLayout(
  layout: (args: {
    children: React.ReactNode
    params: Promise<{ lang: string }>
  }) => Promise<React.ReactNode>,
  lang: string
) {
  const element = await layout({
    children: <main id="page-content">questionnaire</main>,
    params: Promise.resolve({ lang }),
  })
  return renderToStaticMarkup(element as React.ReactElement)
}

/** Repo root. `vitest.config.ts` lives there and resolves `@` against `./src` from it. */
const APP = path.resolve(process.cwd(), 'src/app/(choice)/[lang]')

describe('the questionnaires live in the (plain) group', () => {
  // Cheap, and the only assertions in this file that survive a directory rename. Both
  // directions are asserted: present under (plain) AND absent under (pitch), because a copy
  // left behind in the wrong group is a build failure nobody would attribute to this rule.
  for (const product of ['mbti', 'iq'] as const)
    it(`${product}/test is under (plain), not (pitch)`, () => {
      expect(
        existsSync(path.join(APP, product, '(plain)/test/page.tsx')),
        `${product}/test/page.tsx is not in the (plain) group - if it moved to (pitch), /[lang]/${product}/test now renders the availability block next to the answer buttons`
      ).toBe(true)

      expect(
        existsSync(path.join(APP, product, '(pitch)/test')),
        `a ${product}/test directory appeared in the (pitch) group`
      ).toBe(false)
    })

  it('the path these assertions resolve against is real', () => {
    // Guards the guard. `existsSync` on a wrong root returns false for everything, which
    // would turn the "absent from (pitch)" half above into a test that always passes.
    expect(
      existsSync(path.join(APP, 'layout.tsx')),
      `APP does not resolve: ${APP}`
    ).toBe(true)
  })
})

describe('availability block placement', () => {
  for (const lang of LOCALES) {
    it(`is ABSENT from the shell wrapping /${lang}/mbti/test`, async () => {
      const html = await renderLayout(MbtiPlainLayout, lang)

      expect(html).not.toContain(BLOCK_MARKER)
      // The shell itself still rendered, so the assertion above is about the block and not
      // about an empty string.
      expect(html).toContain('portfolio-public-root')
      expect(html).toContain('id="page-content"')
    })

    it(`is ABSENT from the shell wrapping /${lang}/iq/test`, async () => {
      const html = await renderLayout(IqPlainLayout, lang)

      expect(html).not.toContain(BLOCK_MARKER)
      expect(html).toContain('portfolio-public-root')
      expect(html).toContain('id="page-content"')
    })

    it(`is PRESENT on the /${lang}/mbti pitch shell, so the probe above can detect it`, async () => {
      const html = await renderLayout(MbtiPitchLayout, lang)

      expect(html).toContain(BLOCK_MARKER)
    })

    it(`is PRESENT on the /${lang}/iq pitch shell, so the probe above can detect it`, async () => {
      const html = await renderLayout(IqPitchLayout, lang)

      expect(html).toContain(BLOCK_MARKER)
    })
  }

  it('renders the block in the locale of the page it sits on', async () => {
    // The tests are bilingual and the blog is not (D7), so this component is the one place
    // the pitch has to exist in Vietnamese. A single-language block would silently show
    // English to the Vietnamese audience that is most of this traffic.
    expect(await renderLayout(MbtiPitchLayout, 'vi')).toContain('Liên hệ')
    expect(await renderLayout(MbtiPitchLayout, 'en')).toContain('Get in touch')
  })

  it('rejects a locale that is not real, rather than rendering a shell for it', async () => {
    // Each group layout re-validates `lang` instead of trusting the parent. If that check
    // were dropped, `/garbage/mbti/test` would render the product under a nonsense
    // language - and `isLocale` is also what narrows the type for the shell below it.
    await expect(renderLayout(MbtiPlainLayout, 'garbage')).rejects.toThrow(
      'notFound() called'
    )
    await expect(renderLayout(IqPitchLayout, 'garbage')).rejects.toThrow(
      'notFound() called'
    )
  })
})
