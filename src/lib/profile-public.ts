import type { Profile } from '@/types/profile'

/**
 * Fields safe to serve on public surfaces.
 *
 * This is an ALLOWLIST, not a denylist: every field absent from this array is private by
 * default, including every field added to {@link Profile} in the future. Adding a field
 * here is the single, reviewable act that makes it public.
 *
 * NEVER add: email, phone, date of birth, street address / ward / district, national id,
 * salary expectation, referee contact details, or any field whose value is a route to
 * reach a person directly. The CV block (`resume`) is deliberately absent - `/cv` renders
 * it as a page through `loadPublicResume`, but it is never served as machine-readable JSON.
 */
export const PUBLIC_PROFILE_FIELDS = [
  'cv',
  'fullName',
  'username',
  'jobTitle',
  'description',
  'avatar',
  'backgroundImage',
  'publicLocation',
  'socials',
  'profileHeading',
  'profileSubHeading',
  'stats',
  'aboutMe',
  'skills',
  'experience',
  'education',
  'certificates',
  'serviceHeading',
  'serviceSubHeading',
  'briefServices',
  'services',
  'workHeading',
  'workSubHeading',
  'projects',
] as const satisfies readonly (keyof Profile)[]

/**
 * The profile shape public callers receive. Renderers and view models take this type
 * rather than {@link Profile}, so a newly added private field cannot reach them even by
 * accident - it is not in the `Pick`.
 */
export type PublicProfile = Pick<
  Profile,
  (typeof PUBLIC_PROFILE_FIELDS)[number]
>

/** Mongo projection, so private fields never enter the Node process at all. */
export const PUBLIC_PROFILE_PROJECTION = PUBLIC_PROFILE_FIELDS.join(' ')

/**
 * The only supported path from a stored document to a public shape.
 *
 * `ProfileModel` is typed `any`, so the Mongo-level projection is not type-checked - this
 * function is the real gate. Do not route around it.
 */
export function toPublicProfile(profile: Profile): PublicProfile {
  const out = {} as Record<string, unknown>
  for (const key of PUBLIC_PROFILE_FIELDS) out[key] = profile[key]

  return out as PublicProfile
}
