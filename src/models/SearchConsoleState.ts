import mongoose, { Schema } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'

/**
 * The last sitemap submit to Google Search Console. One document, forever.
 *
 * ```
 *   board "Resubmit sitemap" ─┐
 *                             ├─▶ resubmitSitemap() ─▶ upsert _id 'sitemap'
 *   publish hook (after()) ───┘        ok:   lastSubmittedAt, lastTrigger; unset lastError
 *                                      fail: lastError, lastErrorAt, lastTrigger
 * ```
 *
 * ## Why this is stored at all
 *
 * The publish hook runs after the response, so its failures land in a log nobody reads. A
 * rotated key or a service account left as a Restricted user would fail every resubmit
 * silently forever. Writing the outcome here is what lets the board show a rose marker
 * instead.
 *
 * Same singleton idiom as `CcafProgress` and `Profile`: one owner, one property, one row. No
 * TTL - it holds no visitor data, only the owner's last call to Google.
 */

export const SEARCH_CONSOLE_STATE_ID = 'sitemap'

export type SitemapTrigger = 'manual' | 'publish'

export type SearchConsoleStateDocument = {
  _id: string
  lastSubmittedAt: Date | null
  lastError: string | null
  lastErrorAt: Date | null
  lastTrigger: SitemapTrigger | null
}

const searchConsoleStateSchema = new Schema<SearchConsoleStateDocument>(
  {
    _id: { type: String, default: SEARCH_CONSOLE_STATE_ID },
    lastSubmittedAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 500 },
    lastErrorAt: { type: Date, default: null },
    lastTrigger: {
      type: String,
      enum: ['manual', 'publish', null],
      default: null,
    },
  },
  { collection: 'searchConsoleState', versionKey: false }
)

export const SearchConsoleStateModel: mongoose.Model<SearchConsoleStateDocument> =
  compileModel('SearchConsoleState', searchConsoleStateSchema)
