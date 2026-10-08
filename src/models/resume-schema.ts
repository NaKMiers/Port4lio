import { Schema } from 'mongoose'

/**
 * The `/cv` print copy, as one schema shared by `Profile.resume` (the legacy single block)
 * and `Cv.resume` (multi-CV), so the two can never disagree about a field.
 *
 * Moved out of `Profile.ts` for that reason alone (multi-cv-plan.md A1). A field added here
 * reaches both, which matters because the legacy block is what `ensureMigrated` copies into
 * the first CV - a field one schema had and the other dropped would vanish in that copy.
 */

/** Also used by `Profile.certificates`, which has always shared this shape. */
export const certificateSchema = new Schema(
  {
    link: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  { _id: false }
)

const resumeContactLinkSchema = new Schema(
  {
    label: { type: String, default: '' },
    text: { type: String, default: '' },
    href: { type: String, default: '' },
  },
  { _id: false }
)

const resumeContactSchema = new Schema(
  {
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    location: { type: String, default: '' },
    links: { type: [resumeContactLinkSchema], default: [] },
  },
  { _id: false }
)

const resumeTextBlockSchema = new Schema(
  {
    heading: { type: String, default: '' },
    lines: { type: [String], default: [] },
  },
  { _id: false }
)

const resumeSkillRowSchema = new Schema(
  { items: { type: [String], default: [] } },
  { _id: false }
)

const resumeSkillBlockSchema = new Schema(
  {
    heading: { type: String, default: '' },
    rows: { type: [resumeSkillRowSchema], default: [] },
  },
  { _id: false }
)

const resumeCertificationGroupSchema = new Schema(
  {
    issuer: { type: String, default: '' },
    items: { type: [certificateSchema], default: [] },
  },
  { _id: false }
)

const resumeCertificationBlockSchema = new Schema(
  {
    heading: { type: String, default: '' },
    groups: { type: [resumeCertificationGroupSchema], default: [] },
  },
  { _id: false }
)

const resumeLinkSchema = new Schema(
  {
    label: { type: String, default: '' },
    href: { type: String, default: '' },
  },
  { _id: false }
)

const resumeProjectSchema = new Schema(
  {
    employer: { type: String, default: '' },
    title: { type: String, default: '' },
    period: { type: String, default: '' },
    details: { type: [String], default: [] },
    highlights: { type: [String], default: [] },
    demoLinks: { type: [resumeLinkSchema], default: [] },
  },
  { _id: false }
)

const resumeProjectSectionSchema = new Schema(
  {
    heading: { type: String, default: '' },
    items: { type: [resumeProjectSchema], default: [] },
  },
  { _id: false }
)

const resumePageBreakSchema = new Schema(
  {
    sectionIndex: { type: Number, default: 0 },
    projectIndex: { type: Number, default: 0 },
    highlightsOnFirstSheet: { type: Number, default: 0 },
  },
  { _id: false }
)

export const resumeSchema = new Schema(
  {
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    photo: { type: String, default: '' },
    hidePhoto: { type: Boolean, default: false },
    contact: { type: resumeContactSchema, default: undefined },
    // Print order of the blocks below the masthead. An absent or partial array is
    // repaired by `normalizeResumeSectionOrder`, so documents written before this field
    // existed still print every section.
    sectionOrder: { type: [String], default: undefined },
    summary: { type: resumeTextBlockSchema, default: undefined },
    education: { type: resumeTextBlockSchema, default: undefined },
    skillBlocks: { type: [resumeSkillBlockSchema], default: [] },
    certifications: {
      type: resumeCertificationBlockSchema,
      default: undefined,
    },
    projectSections: { type: [resumeProjectSectionSchema], default: [] },
    pageBreak: { type: resumePageBreakSchema, default: undefined },
  },
  { _id: false }
)
