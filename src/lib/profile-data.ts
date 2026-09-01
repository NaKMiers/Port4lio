import { unstable_cache } from 'next/cache'

import { connectDatabase } from '@/lib/mongodb'
import { PROFILE_DOCUMENT_ID, ProfileModel } from '@/models/Profile'
import type { PublicProfile } from './profile-public'
import { PUBLIC_PROFILE_PROJECTION, toPublicProfile } from './profile-public'

import type { Resume } from '@/types/profile'
import { makeEmptyProfile, normalizeProfile, normalizeResume } from './profile'

export const PUBLIC_PROFILE_CACHE_TAG = 'public-profile'
const PUBLIC_PROFILE_REVALIDATE_SECONDS = 60

class PublicProfileDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PublicProfileDataError'
  }
}

/**
 * Reads the singleton profile with the public field projection applied at the query, so
 * private fields never enter this process. See `profile-public.ts` for the allowlist.
 */
async function readPublicProfileDocument(): Promise<Record<string, unknown> | null> {
  try {
    await connectDatabase()
    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID)
      .select(PUBLIC_PROFILE_PROJECTION)
      .lean()
    return doc ? (doc as Record<string, unknown>) : null
  } catch (error) {
    console.error('Failed to load public profile from MongoDB.', error)
    throw new PublicProfileDataError('Failed to load public profile from MongoDB.', { cause: error })
  }
}

async function loadPublicProfileUncached(): Promise<PublicProfile> {
  const doc = await readPublicProfileDocument()
  if (!doc) {
    return toPublicProfile(makeEmptyProfile())
  }

  return toPublicProfile(normalizeProfile(doc))
}

export const loadPublicProfile = unstable_cache(loadPublicProfileUncached, ['public-profile'], {
  revalidate: PUBLIC_PROFILE_REVALIDATE_SECONDS,
  tags: [PUBLIC_PROFILE_CACHE_TAG],
})

export type PublicResumeSource = {
  /** Absent when the document has never had a CV block written - see `deriveResume`. */
  resume: Resume | undefined
  /** The portfolio avatar, which the CV photo falls back to when it is unset. */
  avatar: string
}

async function loadPublicResumeUncached(): Promise<PublicResumeSource> {
  try {
    await connectDatabase()
    // `avatar` rides along on the same query: the CV masthead inherits it whenever no
    // CV-specific photo was uploaded, and a second round trip for one string would only
    // add a way for the two reads to disagree.
    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID).select('resume avatar').lean()
    const record = doc as Record<string, unknown> | null
    const raw = record?.resume

    return {
      resume: raw && typeof raw === 'object' ? normalizeResume(raw) : undefined,
      avatar: typeof record?.avatar === 'string' ? record.avatar : '',
    }
  } catch (error) {
    console.error('Failed to load resume from MongoDB.', error)
    throw new PublicProfileDataError('Failed to load resume from MongoDB.', { cause: error })
  }
}

/**
 * The CV block, for `/cv` only.
 *
 * Kept off the public profile allowlist on purpose: `/cv` renders these contact details
 * as a page - as it always has - but they are never served as machine-readable JSON,
 * which is what makes them cheap to harvest at scale. `avatar` is on the allowlist
 * already, so including it here exposes nothing new.
 */
export const loadPublicResume = unstable_cache(loadPublicResumeUncached, ['public-resume'], {
  revalidate: PUBLIC_PROFILE_REVALIDATE_SECONDS,
  tags: [PUBLIC_PROFILE_CACHE_TAG],
})

/** Its own query - `updatedAt` is not on the public projection. */
async function getPublicProfileUpdatedAtUncached(): Promise<Date | null> {
  try {
    await connectDatabase()
    const doc = await ProfileModel.findById(PROFILE_DOCUMENT_ID).select('updatedAt').lean()
    const raw = (doc as Record<string, unknown> | null)?.updatedAt
    if (raw instanceof Date) return raw
    if (typeof raw === 'string' || typeof raw === 'number') return new Date(raw)
    return null
  } catch (error) {
    console.error('Failed to load public profile timestamp from MongoDB.', error)
    throw new PublicProfileDataError('Failed to load public profile timestamp from MongoDB.', {
      cause: error,
    })
  }
}

export const getPublicProfileUpdatedAt = unstable_cache(
  getPublicProfileUpdatedAtUncached,
  ['public-profile-updated-at'],
  {
    revalidate: PUBLIC_PROFILE_REVALIDATE_SECONDS,
    tags: [PUBLIC_PROFILE_CACHE_TAG],
  }
)
