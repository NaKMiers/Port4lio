import type { PublicProfile } from '@/lib/profile-public'

import { renderFiverr } from './render-fiverr'
import { renderGithubBio } from './render-github-bio'
import { renderGithubReadme } from './render-github-readme'
import { renderLinkedIn } from './render-linkedin'
import { renderUpwork } from './render-upwork'
import type {
  PublishArtifact,
  PublishDrift,
  PublishManifest,
  PublishManifestWithDrift,
  PublishMode,
  PublishTarget,
  PublishTargetId,
  PublishTargetWithDrift,
  RenderContext,
} from './types'
import { PUBLISH_SCHEMA_VERSION, PUBLISH_TARGET_IDS } from './types'
import { combineVersions, hashArtifact } from './version'

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

type TargetSpec = {
  label: string
  mode: PublishMode
  render: (profile: PublicProfile, ctx: RenderContext) => PublishArtifact
}

/**
 * Adding a platform is one entry here plus one renderer file - the admin board renders
 * every `manual` target from the same `{ kind: 'fields' }` shape, so no UI change.
 */
const TARGET_SPECS: Record<PublishTargetId, TargetSpec> = {
  'github-readme': {
    label: 'GitHub profile README',
    mode: 'auto',
    render: renderGithubReadme,
  },
  'github-bio': {
    label: 'GitHub account bio',
    mode: 'auto',
    render: renderGithubBio,
  },
  linkedin: { label: 'LinkedIn', mode: 'manual', render: renderLinkedIn },
  upwork: { label: 'Upwork', mode: 'manual', render: renderUpwork },
  fiverr: { label: 'Fiverr', mode: 'manual', render: renderFiverr },
}

/**
 * Renders every target and hashes each one.
 *
 * Pure and database-free on purpose - drift comes from `attachDrift`, which keeps this
 * function unit-testable without a Mongo connection.
 */
export function buildPublishManifest(
  profile: PublicProfile,
  /**
   * `profileUpdatedAt` accepts a string as well as a Date: `getPublicProfileUpdatedAt`
   * is wrapped in `unstable_cache`, which serializes its return value, so a cache HIT
   * yields an ISO string even though the declared type says Date. Typing it honestly
   * here is what stops that from being an intermittent 500 on the second request.
   */
  ctx: RenderContext & { profileUpdatedAt: Date | string | null }
): PublishManifest {
  const targets = {} as Record<PublishTargetId, PublishTarget>
  const versions: Record<string, string> = {}

  for (const id of PUBLISH_TARGET_IDS) {
    const spec = TARGET_SPECS[id]
    const artifact = spec.render(profile, ctx)
    const version = hashArtifact(artifact)
    versions[id] = version
    targets[id] = { id, label: spec.label, mode: spec.mode, version, artifact }
  }

  return {
    schemaVersion: PUBLISH_SCHEMA_VERSION,
    generatedAt: ctx.now.toISOString(),
    profileUpdatedAt: toIso(ctx.profileUpdatedAt),
    version: combineVersions(versions, PUBLISH_TARGET_IDS),
    targetOrder: PUBLISH_TARGET_IDS,
    targets,
  }
}

export type StoredTargetState = {
  targetId: string
  ackedVersion?: string
  ackedAt?: Date | string | null
  lastResult?: string
  lastRunAt?: Date | string | null
  detail?: string
}

function driftFor(
  target: PublishTarget,
  state: StoredTargetState | undefined,
  generatedAt: string
): PublishDrift {
  const ackedVersion = state?.ackedVersion || null
  const inSync = ackedVersion === target.version

  return {
    inSync,
    ackedVersion,
    ackedAt: toIso(state?.ackedAt),
    // Only meaningful when out of sync; the current artifact is what is unpublished.
    driftSince: inSync ? null : generatedAt,
    lastResult: state?.lastResult || null,
    lastRunAt: toIso(state?.lastRunAt),
    detail: state?.detail || null,
  }
}

/**
 * Merges stored acknowledgement state onto a rendered manifest.
 *
 * A target is green only because something asserted it: the workflow reports its push,
 * or the owner pressed "Mark as pasted". Nothing auto-greens, so a workflow that stops
 * running shows as drift on its own rather than silently staying healthy.
 */
export function attachDrift(
  manifest: PublishManifest,
  states: StoredTargetState[] | null
): PublishManifestWithDrift {
  const byId = new Map((states ?? []).map(state => [state.targetId, state]))
  const targets = {} as Record<PublishTargetId, PublishTargetWithDrift>

  for (const id of PUBLISH_TARGET_IDS)
    targets[id] = {
      ...manifest.targets[id],
      drift: driftFor(manifest.targets[id], byId.get(id), manifest.generatedAt),
    }

  return { ...manifest, targets }
}
