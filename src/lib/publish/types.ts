export const PUBLISH_SCHEMA_VERSION = 1

/** Publish targets, in the order the manifest and the admin board present them. */
export const PUBLISH_TARGET_IDS = [
  'github-readme',
  'github-bio',
  'linkedin',
  'upwork',
  'fiverr',
] as const

export type PublishTargetId = (typeof PUBLISH_TARGET_IDS)[number]

/** `auto` targets are applied by the workflow; `manual` ones are copy-paste kits. */
export type PublishMode = 'auto' | 'manual'

/**
 * Context every renderer needs. `now` is injected rather than read from the clock so
 * artifacts stay pure - a time-dependent artifact would rehash on its own and mark every
 * platform stale with nobody having edited anything.
 */
export type RenderContext = {
  siteOrigin: string
  githubUsername: string
  now: Date
}

export type ManualField = {
  key: string
  label: string
  /** Platform-side cap. See `limits.ts`. */
  limit: number
  /** Already truncated to `limit`, so it is always safe to paste as-is. */
  value: string
  /** Length before truncation - says how much was cut, rather than hiding it. */
  sourceLength: number
  overflow: boolean
  /** Optional note rendered under the field in the admin board. */
  hint?: string
}

export type GithubReadmeArtifact = {
  kind: 'file'
  path: 'README.md'
  /** No trailing newline - `jq -r` in the workflow appends one. */
  content: string
}

export type GithubBioArtifact = {
  kind: 'fields-object'
  name: string
  bio: string
  blog: string
  location: string
  company: string
}

export type ManualArtifact = {
  kind: 'fields'
  fields: ManualField[]
}

export type PublishArtifact = GithubReadmeArtifact | GithubBioArtifact | ManualArtifact

export type PublishTarget = {
  id: PublishTargetId
  label: string
  mode: PublishMode
  /** sha256 over the rendered artifact. Changes exactly when the output text changes. */
  version: string
  artifact: PublishArtifact
}

export type PublishDrift = {
  inSync: boolean
  ackedVersion: string | null
  ackedAt: string | null
  /** When the current artifact was generated, if it differs from what was acked. */
  driftSince: string | null
  /** Last workflow outcome for `auto` targets: applied | unchanged | failed. */
  lastResult: string | null
  lastRunAt: string | null
  detail: string | null
}

export type PublishTargetWithDrift = PublishTarget & { drift: PublishDrift }

export type PublishManifest = {
  schemaVersion: number
  generatedAt: string
  profileUpdatedAt: string | null
  /** sha256 over every per-target version, in `targetOrder`. */
  version: string
  targetOrder: readonly PublishTargetId[]
  targets: Record<PublishTargetId, PublishTarget>
}

export type PublishManifestWithDrift = Omit<PublishManifest, 'targets'> & {
  targets: Record<PublishTargetId, PublishTargetWithDrift>
}

export function isPublishTargetId(value: unknown): value is PublishTargetId {
  return typeof value === 'string' && (PUBLISH_TARGET_IDS as readonly string[]).includes(value)
}
