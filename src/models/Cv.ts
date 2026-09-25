import { Schema, Types } from 'mongoose'

import { compileModel } from '@/lib/mongoose-model'
import { CV_LABEL_MAX } from '@/lib/upload-limits'
import { resumeSchema } from '@/models/resume-schema'
import type { Resume } from '@/types/profile'

/**
 * One printable CV. The owner keeps many; exactly one is published, and that one is `/cv`.
 *
 * ```
 *   _id          ObjectId      the migrated CV always gets LEGACY_CV_ID
 *   label        "Frontend"    trimmed, 1..60 chars, shown in the settings dropdown
 *   labelKey     "frontend"    label.trim().toLowerCase(), unique: labels are unique ignoring case
 *   resume       Resume        required - a CV with no content is an empty Resume, never absent
 *   publishedAt  Date | null   the published CV = the greatest non-null publishedAt, ties by _id
 *   fitVerified  boolean       false after an agent writes it, true after the owner's Save CV
 *   createdAt / updatedAt      timestamps; updatedAt is Save CV's stale-tab base, and the
 *                              `version` the MCP CV tools hand out
 * ```
 *
 * ## Why "published" is a date and not a flag
 *
 * A boolean needs two writes to move - clear the old one, set the new one - and between them
 * there are zero or two published CVs, which without a transaction (the `tests/api` mongod is
 * not a replica set) is a real state `/cv` can observe. Stamping `publishedAt` on the new CV
 * is one single-document write: it becomes the latest the instant it lands, and the previous
 * one needs no change at all. If the published CV is ever removed anyway, the previous
 * publish takes over rather than `/cv` going blank. See `lib/cv/cv-service.ts`.
 *
 * ## Why `labelKey` is a stored field
 *
 * A case-insensitive unique index needs either a collation or a lowered copy. The copy is
 * the one the code can see: the service sets it on every write that changes `label`, and
 * there is no `pre('save')` hook to be skipped by `findOneAndUpdate`.
 *
 * ## Why `fitVerified` exists (multi-cv-plan.md P2-A)
 *
 * `/cv` is fixed A4 (`height: 297mm; overflow: hidden`), so text that runs long is cut off
 * with no signal, and only a browser can measure it (`resume-page-fit.ts` reads DOM
 * geometry). The settings editor measures every CV it opens, so its Save CV is proof the
 * content fits; an agent's write is not. The flag records which happened last. It warns, it
 * never blocks: an unverified CV still publishes, and the tool result says so.
 *
 * A document written before the field existed has no `fitVerified` at all. Every reader
 * treats "absent" as true (`!== false`): those CVs were migrated or saved by the editor.
 */

/**
 * The fixed `_id` of the CV migrated from `profile.resume`. Fixed, so two first loads racing
 * each other collide on `_id` - an index Mongo always has, built or not - and the loser
 * gets E11000 instead of creating a second "Main CV". `ensureMigrated` swallows that
 * error; the caller's next read (`listCvs`'s `find`, or the write's own filter) sees the
 * winner's CV (multi-cv-plan.md OV-2).
 */
export const LEGACY_CV_ID = new Types.ObjectId('000000000000000000000001')

export type CvDocument = {
  _id: Types.ObjectId
  label: string
  labelKey: string
  resume: Resume
  publishedAt: Date | null
  fitVerified: boolean
  createdAt: Date
  updatedAt: Date
}

const cvSchema = new Schema<CvDocument>(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: CV_LABEL_MAX,
    },
    labelKey: { type: String, required: true, unique: true },
    resume: { type: resumeSchema, required: true },
    publishedAt: { type: Date, default: null },
    fitVerified: { type: Boolean, default: true },
  },
  { collection: 'cvs', timestamps: true, versionKey: false }
)

// Serves `findPublished`: filter non-null, sort newest first, ties broken by `_id`.
cvSchema.index({ publishedAt: -1, _id: -1 })

export const CvModel = compileModel<CvDocument>('Cv', cvSchema)
