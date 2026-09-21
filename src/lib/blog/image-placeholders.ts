/**
 * `![alt](image1)` - the stand-in a generated post leaves where a picture should go.
 *
 * ```
 *   generation ──▶ body contains ![image](image1) ... ![image](image2)
 *                  + one image prompt stored per key
 *                        │
 *                        ▼
 *   editor         ⚠ 2 images still missing          ← top of the markdown card
 *                  [ prompt ] [copy] [regenerate]    ← one card per key, below it
 *                  [ url ] [upload]
 *                        │
 *                        ▼
 *   replacePlaceholder ──▶ ![image](https://res.cloudinary.com/...)
 *                          the card disappears, because the placeholder is gone
 *
 *   left unresolved ──▶ <img alt="..."> with no src: a broken image, on the live post
 * ```
 *
 * ## Why a bare `image1` and not `placeholder://image1` or a comment
 *
 * Because of what the renderer already does with it. `rehypeRestrictImageHosts` calls
 * `new URL(value)` with no base and `image1` makes that throw, so the attribute is refused.
 * The browser is therefore never asked to fetch anything: a placeholder cannot phone home, and
 * it cannot be turned into a tracking pixel by getting markdown into a draft.
 *
 * What it DOES render as was measured rather than assumed, because the two candidate answers
 * lead to different UI. The plugin deletes the offending ATTRIBUTE and keeps the node, so
 * `![a chart](image1)` comes out of the real pipeline as:
 *
 * ```
 *   <p><img alt="a chart"></p>
 * ```
 *
 * A sourceless `<img>` - which every browser paints as a broken-image icon with the alt text
 * beside it. So an unresolved placeholder is not invisible; it publishes as visible damage on
 * the live post. That is why the editor's warning is a banner above the textarea rather than a
 * quiet hint: the cost of shipping one is a reader seeing a broken picture, not a reader
 * seeing a paragraph with no picture.
 *
 * A URL scheme like `placeholder://image1` would survive `new URL` and then be *kept* by any
 * check looking only at the hostname, which is the worse half of that trade.
 *
 * ## Why this file has no imports
 *
 * Same rule as `constants.ts` and `generation-fields.ts`: the editor is a client component
 * and reaches all three of these functions, so nothing here may drag mongoose into the
 * browser bundle.
 */

/**
 * `![alt](imageN)`, with the alt and the number captured.
 *
 * Deliberately narrow. `image` followed by digits and nothing else - not `image-1`, not
 * `img1`, not `image1.png`. The set of strings this matches has to be a set no real image URL
 * can land in, because a false positive here means the editor offers to "fix" a link that was
 * already correct, and a `replacePlaceholder` that then rewrites it.
 */
export const IMAGE_PLACEHOLDER_PATTERN = /!\[([^\]]*)\]\((image\d+)\)/g

export type ImagePlaceholder = {
  /** `image1`. The key an image prompt is stored under. */
  key: string
  /** Whatever alt text is on the placeholder, preserved through a replacement. */
  alt: string
}

/**
 * Every placeholder still in the body, in the order they appear, without duplicates.
 *
 * Order matters: it is the order the prompt cards render in, and a list that did not match
 * the body would have the author matching "the second prompt" against the third picture.
 *
 * Duplicates are collapsed rather than listed twice. The same key used in two places is one
 * image shown twice, so it is one prompt and one upload - and `replacePlaceholder` fills both
 * from that single upload.
 */
export function findImagePlaceholders(markdown: string): ImagePlaceholder[] {
  const found: ImagePlaceholder[] = []
  const seen = new Set<string>()

  // `matchAll` rather than a `while (exec())` loop: the pattern is a module-level `/g` regex,
  // so it carries `lastIndex` between calls and a shared `exec` loop would start midway
  // through the string on its second caller. `matchAll` clones the regex internally.
  //
  // `Array.from` around it because tsconfig targets ES5 without `downlevelIteration`, so a
  // bare `for...of` over the iterator does not compile.
  for (const match of Array.from(
    markdown.matchAll(IMAGE_PLACEHOLDER_PATTERN)
  )) {
    const [, alt, key] = match
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ key, alt })
  }

  return found
}

/**
 * Swap every `![alt](imageN)` for `![alt](url)`, keeping the alt text.
 *
 * The alt is kept rather than replaced because it is the one part of the placeholder an
 * author is likely to have improved by hand - it is the text a screen reader reads and the
 * text shown if the image later 404s, and a replacement that reset it to "image" would
 * quietly undo that work at the moment the picture arrives.
 *
 * `url` is inserted verbatim. It is not escaped and not validated here: the caller has the
 * upload response or a URL the owner typed, `renderMarkdown` runs it past
 * `rehypeRestrictImageHosts`, and a "cleverly" escaped URL would break the Cloudinary paths
 * that are the entire point.
 */
export function replacePlaceholder(
  markdown: string,
  key: string,
  url: string
): string {
  // Built per call rather than reusing the module constant, for the `lastIndex` reason above,
  // and anchored on the exact key so `image1` cannot match inside `image12`.
  const pattern = new RegExp(`!\\[([^\\]]*)\\]\\(${key}\\)`, 'g')
  return markdown.replace(pattern, (_match, alt: string) => `![${alt}](${url})`)
}

/**
 * The placeholder markdown for a key, as the model is told to write it.
 *
 * One function so the generator's instruction, the tests and any future "insert an image
 * here" button all produce the same string. A format agreed in three places by copying is a
 * format that drifts.
 */
export function placeholderMarkdown(key: string): string {
  return `![image](${key})`
}

/**
 * Every markdown image in the body - placeholders AND ones that already have a real URL.
 *
 * NOT the same question as `findImagePlaceholders`, and conflating the two was a real bug.
 * That function answers "what is still outstanding", which is what the editor's warning and
 * its upload cards need. This one answers "how many pictures does this post have", which is
 * what a REGENERATION preset needs - and the difference is exactly a post whose images were
 * already uploaded. Counting outstanding placeholders there returns 0, so the rewrite was
 * told "Images: none" and came back with no pictures at all, for a post that visibly had two.
 *
 * Images inside fenced code blocks are counted too. A post that shows `![alt](url)` as an
 * example would read one too many, which costs one extra placeholder on a rewrite - cheap
 * next to a fence-stripping regex that has to be right about nested and indented fences.
 */
export function countBodyImages(markdown: string): number {
  return (markdown.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).length
}

/** `image1`, `image2`, ... for a count. The keys the generator is asked to use. */
export function placeholderKeys(count: number): string[] {
  return Array.from(
    { length: Math.max(0, count) },
    (_, index) => `image${index + 1}`
  )
}

/**
 * The real image URLs already in a body, in the order they appear.
 *
 * The third question in this file, and the one a REWRITE needs: not "what is outstanding"
 * (`findImagePlaceholders`) and not "how many pictures" (`countBodyImages`), but "which
 * pictures does this post already have". An `imageN` target is a placeholder, not a URL, so it
 * is excluded - everything else is something the author uploaded or pasted.
 */
export function resolvedImageUrls(markdown: string): string[] {
  const urls: string[] = []
  for (const match of Array.from(
    markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)
  )) {
    const url = match[1]
    if (!/^image\d+$/.test(url)) urls.push(url)
  }
  return urls
}

/**
 * Put a rewrite's new placeholders back over the pictures the old body already had.
 *
 * ## The failure this exists to stop
 *
 * Regenerating a post replaces its whole body. The new body is placeholders, because that is
 * all a text model can produce - so a PUBLISHED post with two uploaded Cloudinary images got
 * its body swapped for `![image](image1)` / `![image](image2)`, kept `status: 'published'`,
 * and revalidated. `rehypeRestrictImageHosts` deletes the `src` and KEEPS the node, so within
 * the ISR flush every reader of a live article saw two broken-image icons, and two images the
 * author had made and paid for were orphaned. Nothing in the confirm copy mentioned it.
 *
 * ## Why by position, and why that is honest
 *
 * There is no way to know that the new `image1` means the same picture as the old one - the
 * body is different text. Position is the only correspondence available, and it is right in
 * the common case (a rewrite of the same post, same shape, pictures in the same order) and
 * visibly wrong rather than invisibly wrong when it is not: the author sees the old picture
 * under new prose and can re-upload. The alternative, which is what shipped, is a broken image
 * on a live page that nobody is told about.
 *
 * Surplus placeholders past the number of old pictures are left as placeholders - they are
 * genuinely new slots. Surplus PICTURES past the number of new placeholders are dropped from
 * the body, and the caller warns about them by name so the URLs are not silently lost.
 */
export function carryForwardImages(
  newMarkdown: string,
  oldMarkdown: string
): { markdown: string; carried: number; dropped: string[] } {
  const urls = resolvedImageUrls(oldMarkdown)
  if (urls.length === 0)
    return { markdown: newMarkdown, carried: 0, dropped: [] }

  const placeholders = findImagePlaceholders(newMarkdown)
  let markdown = newMarkdown
  let carried = 0

  // Index loop, not `.entries()`: tsconfig targets es5 without `downlevelIteration`, so
  // iterating an iterator is a TS2802 here.
  for (let index = 0; index < placeholders.length; index += 1) {
    const url = urls[index]
    if (url === undefined) break
    markdown = replacePlaceholder(markdown, placeholders[index].key, url)
    carried += 1
  }

  return { markdown, carried, dropped: urls.slice(placeholders.length) }
}
