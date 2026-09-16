import mongoose, { Schema } from 'mongoose'

/** Single portfolio document id (singleton row in `profile` collection). */
export const PROFILE_DOCUMENT_ID = process.env.PROFILE_DOCUMENT_ID!

const socialLinkSchema = new Schema(
  {
    link: { type: String, default: '' },
    icon: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  { _id: false }
)

const statSchema = new Schema(
  {
    label: { type: String, default: '' },
    value: { type: Number, default: 0 },
  },
  { _id: false }
)

const skillItemSchema = new Schema(
  {
    icon: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  { _id: false }
)

const skillGroupSchema = new Schema(
  {
    groupName: { type: String, default: '' },
    items: { type: [skillItemSchema], default: [] },
  },
  { _id: false }
)

const experienceSchema = new Schema(
  {
    companyName: { type: String, default: '' },
    position: { type: String, default: '' },
    start: { type: String, default: '' },
    end: { type: String, default: '' },
  },
  { _id: false }
)

const educationSchema = new Schema(
  {
    schoolName: { type: String, default: '' },
    major: { type: String, default: '' },
    start: { type: String, default: '' },
    end: { type: String, default: '' },
  },
  { _id: false }
)

const certificateSchema = new Schema(
  {
    link: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  { _id: false }
)

const serviceItemSchema = new Schema(
  {
    icon: { type: String, default: '' },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { _id: false }
)

const projectPartSchema = new Schema(
  {
    image: { type: String, default: '' },
    description: { type: String, default: '' },
    link: { type: String, default: '' },
  },
  { _id: false }
)

const projectItemSchema = new Schema(
  {
    title: { type: String, default: '' },
    overview: { type: String, default: '' },
    techStack: { type: [String], default: [] },
    parts: { type: [projectPartSchema], default: [] },
  },
  { _id: false }
)

/* ---- resume (print copy for /cv) ------------------------------------------- */

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

const resumeSkillRowSchema = new Schema({ items: { type: [String], default: [] } }, { _id: false })

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

const resumeSchema = new Schema(
  {
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    photo: { type: String, default: '' },
    contact: { type: resumeContactSchema, default: undefined },
    // Print order of the blocks below the masthead. An absent or partial array is
    // repaired by `normalizeResumeSectionOrder`, so documents written before this field
    // existed still print every section.
    sectionOrder: { type: [String], default: undefined },
    summary: { type: resumeTextBlockSchema, default: undefined },
    education: { type: resumeTextBlockSchema, default: undefined },
    skillBlocks: { type: [resumeSkillBlockSchema], default: [] },
    certifications: { type: resumeCertificationBlockSchema, default: undefined },
    projectSections: { type: [resumeProjectSectionSchema], default: [] },
    pageBreak: { type: resumePageBreakSchema, default: undefined },
  },
  { _id: false }
)

const profileSchema = new Schema(
  {
    _id: { type: String, default: PROFILE_DOCUMENT_ID },
    cv: { type: String, default: '' },
    // `default: undefined` is load-bearing: it keeps "never written" distinguishable from
    // "written and empty", which `deriveResume` relies on to decide whether to seed.
    resume: { type: resumeSchema, default: undefined },
    fullName: { type: String, default: '' },
    username: { type: String, default: '' },
    jobTitle: { type: [String], default: [] },
    description: { type: String, default: '' },
    avatar: { type: String, default: '' },
    backgroundImage: { type: String, default: '' },
    publicLocation: { type: String, default: '' },
    socials: { type: [socialLinkSchema], default: [] },
    profileHeading: { type: String, default: '' },
    profileSubHeading: { type: String, default: '' },
    stats: { type: [statSchema], default: [] },
    aboutMe: { type: String, default: '' },
    skills: { type: [skillGroupSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    certificates: { type: [certificateSchema], default: [] },
    serviceHeading: { type: String, default: '' },
    serviceSubHeading: { type: String, default: '' },
    briefServices: { type: [String], default: [] },
    services: { type: [serviceItemSchema], default: [] },
    workHeading: { type: String, default: '' },
    workSubHeading: { type: String, default: '' },
    projects: { type: [projectItemSchema], default: [] },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  {
    collection: 'profile',
    versionKey: false,
  }
)

export const ProfileModel: any = mongoose.models.Profile ?? mongoose.model('Profile', profileSchema)
