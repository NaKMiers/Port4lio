import Link from 'next/link'

/**
 * The visible trail, rendered from the same list that becomes `BreadcrumbList` JSON-LD.
 *
 * ## Why this replaced a single "← Writing" link
 *
 * Google's structured data guidelines require breadcrumb markup to describe a trail the page
 * actually shows; markup with nothing behind it is the kind of mismatch that earns a manual
 * action rather than a rich result. The post page has emitted a three-level `BreadcrumbList`
 * since the blog shipped and rendered one back-link, so the trail Google was being told about
 * was one a reader could not see.
 *
 * The payoff for getting it right is concrete: Google renders the trail in place of the raw
 * URL in a result, and `anhkhoa.info › Writing › Measuring revalidatePath` earns a click that
 * `anhkhoa.info/blog/measuring-revalidatepath` does not. `lib/iq/seo.ts` records the same
 * reasoning for the same reason.
 *
 * ## The last crumb is not a link
 *
 * It is the page you are on. A link to the current URL is a dead control for a mouse user and
 * a confusing one for a screen reader, so it renders as text with `aria-current='page'` -
 * which is also exactly what the JSON-LD says, where the final `ListItem` names the current
 * page.
 */
export type Crumb = { name: string; href: string }

export default function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  if (trail.length === 0) return null

  return (
    <nav aria-label='Breadcrumb' className='mb-8 text-sm'>
      <ol className='flex flex-wrap items-center gap-x-2 gap-y-1 text-pp-muted'>
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1

          return (
            <li key={crumb.href} className='flex items-center gap-2'>
              {index > 0 ? (
                // `pp-line` is the border token and renders as very nearly the page
                // background, so a separator drawn in it is invisible and the trail reads as
                // three unrelated words. Muted at 60% is a separator you can see without it
                // competing with the crumbs it separates.
                <span aria-hidden className='text-pp-muted/60'>
                  /
                </span>
              ) : null}
              {isLast ? (
                // Truncated so a long post title does not wrap the trail onto three lines on a
                // phone. The full title is the `h1` immediately below it, so nothing is lost.
                <span aria-current='page' className='block max-w-[22ch] truncate sm:max-w-none'>
                  {crumb.name}
                </span>
              ) : (
                <Link href={crumb.href} className='no-underline hover:text-pp-text'>
                  {crumb.name}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
