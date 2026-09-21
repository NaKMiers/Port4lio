import { Schema } from 'mongoose'

import { KIND_SLUG_PATTERN } from '@/lib/blog/constants'
import { compileModel } from '@/lib/mongoose-model'

/**
 * A post kind: the tier a post is written at, and how its card announces itself.
 *
 * ```
 *   slug     note      ← what Post.kind stores. Immutable, like a series slug.
 *   label    Note      ← the word shown on the card, when `eyebrow` is on
 *   eyebrow  true      ← show `label` above the title?
 *   order    1         ← position in the editor's dropdown
 * ```
 *
 * ## `eyebrow` is the whole of what `kind` ever did
 *
 * This deserves stating precisely, because the field sounds like it should do more.
 * `PostCard` branched on `kind === 'note'` in exactly two places: it rendered a "Note"
 * eyebrow, and it added `mt-1` to the heading to sit under it. Nothing else on the site read
 * the field. The prose about two tiers - a cheap format and an expensive one - is a rule
 * about how the author works, enforced by `docs/blog/authoring.md` and by the cost of
 * writing, not by any branch in the code.
 *
 * So a boolean captures it honestly, and it generalises the way a `rendersAs: 'article' |
 * 'note'` enum would not: a new kind chooses whether to name itself on the card, rather than
 * inheriting one of two hardcoded identities and pretending that is a layout system.
 *
 * ## Why the tier idea survives anyway
 *
 * Making the list editable does not weaken the argument for having two. Of 27 blogs reviewed
 * for this feature, 10 had gone quiet, and the pattern was a site with only one expensive
 * format. That is still true; it is just no longer enforced by a union type that also
 * prevented adding a third tier when one turns out to be wanted.
 *
 * `slug` is immutable for the same reason a series slug is: posts reference it by value, and
 * a rename would orphan them. `label` is the editable presentational half.
 */

export type KindDocument = {
  slug: string
  label: string
  /** Whether `label` is printed above the title on the card, the way `note` always has been. */
  eyebrow: boolean
  order: number
  createdAt: Date
  updatedAt: Date
}

const kindSchema = new Schema<KindDocument>(
  {
    slug: {
      type: String,
      required: true,
      match: KIND_SLUG_PATTERN,
      unique: true,
    },
    label: { type: String, required: true, maxlength: 40 },
    eyebrow: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { collection: 'blog_kinds', timestamps: true, versionKey: false }
)

kindSchema.index({ order: 1, slug: 1 })

export const KindModel = compileModel<KindDocument>('Kind', kindSchema)
