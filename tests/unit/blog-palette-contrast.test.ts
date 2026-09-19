import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The blog's ink palette, checked against WCAG contrast on the page it actually renders on.
 *
 * ## Why this test exists at all
 *
 * The site had five accent tokens and they were chosen as DECORATION colours - for floating
 * shapes, rings and washes over white panels. One of them, `--pp-blue`, was also being used as
 * the link colour in `.blog-prose`, where it sat at 2.70:1 against `--pp-bg`. That is below
 * the 3:1 floor for large text, let alone the 4.5:1 for body copy, and it survived because a
 * link is underlined and nobody measured it.
 *
 * Making the blog colourful meant putting accent on eight more things. Doing that with the
 * bright tokens would have turned one quiet accessibility defect into eight, so the ink family
 * was derived instead - the same five hues, darkened until they pass. This test is what stops
 * the obvious future edit ("these look a bit muddy, let's brighten them") from undoing that
 * silently: the values are read out of the real stylesheet, not restated here, so editing
 * `globals.css` is what the assertion sees.
 *
 * ## Why it does not assert the bright tokens pass
 *
 * They are not supposed to. `--pp-blue` on `--pp-bg` is 2.70:1 and that is fine for a 4px
 * gradient bar beside a heading, a `::marker`, a border or a 10% background wash - none of
 * which is text. The rule the codebase follows is "bright for shapes, ink for type", and a
 * test demanding both pass would be arguing for a palette with no bright colours in it.
 */

const CSS = readFileSync(path.resolve(__dirname, '../../src/styles/globals.css'), 'utf8')

/** Pull a hex custom property out of the real stylesheet, so the test cannot drift from it. */
function token(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`--${name} is not declared as a hex value in globals.css`)
  return match[1]
}

/** WCAG 2.x relative luminance. sRGB channels, linearised, then the standard coefficients. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

const BG = token('pp-bg')

describe('the ink palette carries text on the blog background', () => {
  const INKS = ['pp-ink-blue', 'pp-ink-violet', 'pp-ink-green', 'pp-ink-rose', 'pp-ink-amber']

  it.each(INKS)('%s clears AA for body text (4.5:1)', name => {
    expect(contrast(token(name), BG)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the body ink far above everything accented, so it stays the baseline', () => {
    /*
      Not a WCAG rule - a design one, and the reason the prose itself was left uncoloured.
      Accent only reads as accent while there is a plainer thing to read it against. If an ink
      ever crept up to `--pp-text`'s contrast, headings would stop standing out and the page
      would just be loud.
    */
    const body = contrast(token('pp-text'), BG)
    expect(body).toBeGreaterThan(14)

    for (const name of INKS) {
      expect(contrast(token(name), BG)).toBeLessThan(body)
    }
  })
})

describe('the bright accents are decoration, and the code says so', () => {
  it('records that they do NOT pass as text - which is why the ink family exists', () => {
    // Pinned as documentation. If someone "fixes" `--pp-blue` to a darker value, this fails and
    // sends them here to read why there are two families rather than one.
    expect(contrast(token('pp-blue'), BG)).toBeLessThan(4.5)
    expect(contrast(token('pp-orange'), BG)).toBeLessThan(4.5)
  })

  it('is not what `.blog-prose a` uses any more', () => {
    // The specific defect this work fixed: every link in every post was at 2.70:1.
    const linkRule = CSS.match(/\.blog-prose a \{[^}]*\}/)?.[0] ?? ''

    expect(linkRule).toContain('--pp-ink-blue')
    expect(linkRule).not.toContain('var(--pp-blue)')
  })
})

describe('body copy is left alone', () => {
  it('sets .blog-prose to the plain text ink, not an accent', () => {
    /*
      The load-bearing restraint of the whole change. Colouring paragraphs is how a "colourful"
      reading surface becomes an unreadable one - and it would also cost every accent its
      meaning, because nothing would be the baseline any more.
    */
    const base = CSS.match(/\.blog-prose \{[^}]*\}/)?.[0] ?? ''

    expect(base).toContain('color: var(--pp-text)')
  })

  it('restates the paragraph colour, because the container rule alone loses the cascade', () => {
    /*
      A measured bug, not a hypothetical. `.portfolio-public-root p { color: var(--pp-muted) }`
      is a (0,2,0) selector, and inheritance loses to any rule at all - so every `<p>` in a post
      rendered at `rgb(109, 102, 97)` while the `<li>` beside it rendered at `rgb(31, 28, 26)`.
      Body copy was the faintest text in the article.

      This also has to stay BELOW that rule in the file: both selectors are (0,2,0), so the win
      is on source order.
    */
    expect(CSS).toContain('.blog-prose p { color: var(--pp-text); }')
    expect(CSS.indexOf('.blog-prose p {')).toBeGreaterThan(
      CSS.indexOf('.portfolio-public-root p {')
    )
  })
})
