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

const profileSchema = new Schema(
  {
    _id: { type: String, default: PROFILE_DOCUMENT_ID },
    cv: { type: String, default: '' },
    fullName: { type: String, default: '' },
    username: { type: String, default: '' },
    jobTitle: { type: [String], default: [] },
    description: { type: String, default: '' },
    avatar: { type: String, default: '' },
    backgroundImage: { type: String, default: '' },
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
