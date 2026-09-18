import { Schema } from 'mongoose'

import { SERIES_SLUG_PATTERN } from '@/lib/blog/constants'
import { compileModel } from '@/lib/mongoose-model'

/**
 * A blog series: the cluster a post belongs to, and the copy that introduces it on `/blog`.
 *
 * ```
 *   slug     measured-in-production     ← what Post.series stores. Immutable once created.
 *   title    Measured in production     ← the <h2> on the index
 *   blurb    Things I tested against…   ← the line under it
 *   order    0                          ← where the cluster sits on the index
 * ```
 *
 * ## Why this is a collection and not still a `const`
 *
 * It was `POST_SERIES` in `lib/blog/constants.ts`, a frozen tuple, with a matching
 * `SERIES_COPY` record hardcoded in `app/(blog)/blog/page.tsx`. That is a fine shape for
 * three values that never change and a bad one the moment they do: adding a fourth series
 * meant editing a constant, a mongoose enum, an API validator and a copy map in a page
 * component, and forgetting the last one shipped a cluster with no heading.
 *
 * The title and blurb live HERE rather than staying in the page for exactly that reason. A
 * series whose copy is somewhere else is a series that can be created without any.
 *
 * ## The slug is still a closed set, which was the original point
 *
 * `constants.ts` argued that a free-text series field produces `measured-in-production`,
 * `Measured in production` and `measured_in_prod` inside a month, splitting one cluster into
 * three. That argument is untouched: `Post.series` is still validated against a list, the
 * list is just editable now. What changed is who edits it, not whether it is closed.
 *
 * `slug` is immutable after creation, and that is deliberate rather than an omission. Posts
 * reference a series BY SLUG, so renaming one would orphan every post pointing at the old
 * value - the same reason a published post's own slug freezes. Title and blurb are the
 * fields that carry presentation, and both are freely editable; the slug carries identity.
 */

export type SeriesDocument = {
  slug: string
  title: string
  blurb: string
  /** Ascending. Ties break on `slug`, so the index order is always total and stable. */
  order: number
  createdAt: Date
  updatedAt: Date
}

const seriesSchema = new Schema<SeriesDocument>(
  {
    slug: { type: String, required: true, match: SERIES_SLUG_PATTERN, unique: true },
    title: { type: String, required: true, maxlength: 80 },
    blurb: { type: String, default: '', maxlength: 240 },
    order: { type: Number, default: 0 },
  },
  { collection: 'blog_series', timestamps: true, versionKey: false }
)

// The index page reads every series on every revalidate, always in this order.
seriesSchema.index({ order: 1, slug: 1 })

export const SeriesModel = compileModel<SeriesDocument>('Series', seriesSchema)
