'use client'

import React, { useEffect, useMemo, useState } from 'react'

import AboutSection from '@/components/settings/AboutSection'
import BasicsSection from '@/components/settings/BasicsSection'
import CertificatesSection from '@/components/settings/CertificatesSection'
import EducationSection from '@/components/settings/EducationSection'
import ExperienceSection from '@/components/settings/ExperienceSection'
import IconPickerModal from '@/components/settings/IconPickerModal'
import OwnerAuthGate from '@/components/settings/OwnerAuthGate'
import ProjectsSection from '@/components/settings/ProjectsSection'
import ResumeBlocksSection from '@/components/settings/ResumeBlocksSection'
import ResumeMastheadSection from '@/components/settings/ResumeMastheadSection'
import ResumeProjectsSection from '@/components/settings/ResumeProjectsSection'
import ResumeSkillsSection from '@/components/settings/ResumeSkillsSection'
import { SectionOpenProvider } from '@/components/settings/SectionOpenContext'
import PreviewRail from '@/components/settings/preview/PreviewRail'
import ServicesSection from '@/components/settings/ServicesSection'
import SettingErrorBanner from '@/components/settings/SettingErrorBanner'
import SettingLoadError from '@/components/settings/SettingLoadError'
import SettingLoading from '@/components/settings/SettingLoading'
import SettingToolbar from '@/components/settings/SettingToolbar'
import SkillsSection from '@/components/settings/SkillsSection'
import SocialsSection from '@/components/settings/SocialsSection'
import StatsSection from '@/components/settings/StatsSection'
import TabNav from '@/components/settings/TabNav'
import type { TabItem } from '@/components/settings/TabNav'
import { cleanProfileForSave } from '@/components/settings/cleanProfileForSave'
import type { IconPickerTarget, SettingTabId, UploadingState } from '@/components/settings/types'
import { useApp } from '@/context/AppContext'
import { makeEmptyProfile, normalizeProfile } from '@/lib/profile'
import { deriveResume } from '@/lib/resume-view-model'
import { MAX_PROFILE_JSON_BYTES } from '@/lib/upload-limits'
import type { Profile, ServiceItem } from '@/types/profile'
import { getIconCatalog } from '@/utils/iconResolver'

/** Remembered so a wide-screen setup does not have to be re-chosen every visit. */
const FULL_WIDTH_STORAGE_KEY = 'portfolio:settings:full-width'

function readStoredFullWidth(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(FULL_WIDTH_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

const SETTING_TABS: TabItem[] = [
  { id: 'profile', label: 'Profile', count: 4 },
  { id: 'career', label: 'Career', count: 4 },
  { id: 'offering', label: 'Offering', count: 2 },
  { id: 'cv', label: 'CV', count: 4 },
]

export default function SettingPage() {
  const { refetchProfile } = useApp()

  // The gate sits above everything that needs profile data on purpose. Nested inside the
  // editor, it was unreachable: an unauthenticated visit gets 401 from
  // `/api/admin/profile`, `AppContext` turns that into `profile: null` without an error,
  // and the page fell through to a spinner that nothing could ever clear.
  return (
    <OwnerAuthGate onAuthed={() => void refetchProfile({ blocking: true })}>
      <SettingEditorGate />
    </OwnerAuthGate>
  )
}

function SettingEditorGate() {
  const { profile, setProfile, loading, error, refetchProfile } = useApp()

  if (loading) return <SettingLoading />
  if (error) {
    return (
      <SettingLoadError message={error} onRetry={() => void refetchProfile({ blocking: true })} />
    )
  }

  // A 200 carrying `profile: null` means the document does not exist yet. Open an empty
  // editor so the first save can create it, rather than blocking on data that will never
  // arrive.
  return <SettingEditor appProfile={profile ?? makeEmptyProfile()} setAppProfile={setProfile} />
}

interface SettingEditorProps {
  appProfile: Profile
  setAppProfile: (profile: Profile) => void
}

function SettingEditor({ appProfile, setAppProfile }: SettingEditorProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Seed the CV block so the editor opens pre-populated on a document that predates it.
  // Saving once persists it; from then on the stored value wins.
  const [profile, setProfile] = useState<Profile>(() => {
    const normalized = normalizeProfile(appProfile)
    return { ...normalized, resume: deriveResume(normalized) }
  })
  const [tab, setTab] = useState<SettingTabId>('profile')
  const [fullWidth, setFullWidth] = useState(readStoredFullWidth)
  const [iconPickerTarget, setIconPickerTarget] = useState<IconPickerTarget>(null)
  const [iconQuery, setIconQuery] = useState('')
  const [uploading, setUploading] = useState<UploadingState>({
    avatar: false,
    background: false,
    cv: false,
    cvPhoto: false,
    projects: {},
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(FULL_WIDTH_STORAGE_KEY, JSON.stringify(fullWidth))
    } catch {
      // A blocked or full storage quota costs the preference, nothing more.
    }
  }, [fullWidth])

  const preview = useMemo(() => {
    const bg = profile.backgroundImage || ''
    const av = profile.avatar || ''
    return { bg, av }
  }, [profile.backgroundImage, profile.avatar])

  const iconCatalog = useMemo(() => getIconCatalog(), [])
  const filteredIcons = useMemo(() => {
    const q = iconQuery.trim().toLowerCase()
    if (!q) return iconCatalog
    return iconCatalog.filter(
      item => item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
    )
  }, [iconCatalog, iconQuery])

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      const body = cleanProfileForSave(profile)
      const json = JSON.stringify(body)

      if (new TextEncoder().encode(json).length > MAX_PROFILE_JSON_BYTES) {
        throw new Error(`Profile data exceeds ${MAX_PROFILE_JSON_BYTES / (1024 * 1024)} MB`)
      }

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to save profile')
      if (data?.profile) {
        const next = normalizeProfile(data.profile)
        setAppProfile(next)
        setProfile(next)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const updateService = (idx: number, patch: Partial<ServiceItem>) => {
    setProfile(prev => {
      const next = [...prev.services]
      next[idx] = { ...next[idx], ...patch }
      return { ...prev, services: next }
    })
  }

  const applyIconCode = (iconCode: string) => {
    if (!iconPickerTarget) return

    if (iconPickerTarget.kind === 'skill') {
      setProfile(prev => {
        const nextSkills = [...prev.skills]
        const group = nextSkills[iconPickerTarget.groupIndex]
        if (!group) return prev
        const nextItems = [...group.items]
        const currentItem = nextItems[iconPickerTarget.itemIndex]
        if (!currentItem) return prev
        nextItems[iconPickerTarget.itemIndex] = { ...currentItem, icon: iconCode }
        nextSkills[iconPickerTarget.groupIndex] = { ...group, items: nextItems }
        return { ...prev, skills: nextSkills }
      })
    } else if (iconPickerTarget.kind === 'service') {
      updateService(iconPickerTarget.serviceIndex, { icon: iconCode })
    } else if (iconPickerTarget.kind === 'social') {
      setProfile(prev => {
        const next = [...prev.socials]
        const cur = next[iconPickerTarget.socialIndex]
        if (!cur) return prev
        next[iconPickerTarget.socialIndex] = { ...cur, icon: iconCode }
        return { ...prev, socials: next }
      })
    }

    setIconPickerTarget(null)
    setIconQuery('')
  }

  return (
    <div className='portfolio-public-root relative z-50 min-h-screen clip-decorations pt-12 text-pp-text'>
      <div className='pointer-events-none absolute inset-0 pp-grid-wash opacity-60' />
      <div className='pointer-events-none absolute -left-16 top-32 h-48 w-48 rounded-full bg-pp-orange/15 blur-3xl' />
      <div className='pointer-events-none absolute right-0 top-20 h-64 w-64 rounded-full bg-pp-blue/10 blur-3xl' />
      <div className='pointer-events-none absolute bottom-12 left-1/3 h-52 w-52 rounded-full bg-pp-pink/10 blur-3xl' />

      {/* `max-w-editorial` matches the public site's column. Dropping the class entirely
          rather than swapping in `max-w-none` keeps this working regardless of which
          utilities Tailwind happened to generate. */}
      <div
        className={`relative mx-auto px-gutter py-10 md:py-12 ${
          fullWidth ? '' : 'max-w-editorial'
        }`}
      >
        <SettingToolbar
          saving={saving}
          uploading={uploading}
          fullWidth={fullWidth}
          onToggleFullWidth={() => setFullWidth(value => !value)}
          onSave={onSave}
        />

        <SettingErrorBanner message={error} />

        <TabNav
          tabs={SETTING_TABS}
          activeId={tab}
          onChange={id => setTab(id as SettingTabId)}
          ariaLabel='Profile editor sections'
        />

        <SectionOpenProvider>
          <div
            className={`grid grid-cols-1 gap-6 xl:gap-8 ${
              tab === 'cv'
                ? 'xl:grid-cols-[minmax(0,1fr)_460px]'
                : 'xl:grid-cols-[minmax(0,1fr)_380px]'
            }`}
          >
            {/* Every tab writes into the same `profile` state, so switching tabs never
              discards an unsaved edit - only the section cards unmount. */}
            <div className='space-y-5'>
              {tab === 'profile' ? (
                <>
                  <BasicsSection
                    profile={profile}
                    setProfile={setProfile}
                    preview={preview}
                    uploading={uploading}
                    setUploading={setUploading}
                    setError={setError}
                  />
                  <div className='grid grid-cols-1 items-start gap-5 lg:grid-cols-2'>
                    <SocialsSection
                      profile={profile}
                      setProfile={setProfile}
                      setIconPickerTarget={setIconPickerTarget}
                    />
                    <StatsSection profile={profile} setProfile={setProfile} />
                  </div>
                  <AboutSection profile={profile} setProfile={setProfile} />
                </>
              ) : null}

              {tab === 'career' ? (
                <>
                  <SkillsSection
                    profile={profile}
                    setProfile={setProfile}
                    setIconPickerTarget={setIconPickerTarget}
                  />
                  <ExperienceSection profile={profile} setProfile={setProfile} />
                  <EducationSection profile={profile} setProfile={setProfile} />
                  <CertificatesSection profile={profile} setProfile={setProfile} />
                </>
              ) : null}

              {tab === 'offering' ? (
                <>
                  <ServicesSection
                    profile={profile}
                    setProfile={setProfile}
                    setIconPickerTarget={setIconPickerTarget}
                  />
                  <ProjectsSection
                    profile={profile}
                    setProfile={setProfile}
                    setError={setError}
                    uploading={uploading}
                    setUploading={setUploading}
                  />
                </>
              ) : null}

              {tab === 'cv' ? (
                <>
                  <ResumeMastheadSection
                    profile={profile}
                    setProfile={setProfile}
                    uploading={uploading}
                    setUploading={setUploading}
                    setError={setError}
                  />
                  <ResumeBlocksSection profile={profile} setProfile={setProfile} />
                  <ResumeSkillsSection profile={profile} setProfile={setProfile} />
                  <ResumeProjectsSection profile={profile} setProfile={setProfile} />
                </>
              ) : null}
            </div>

            <div className='xl:pl-2'>
              <PreviewRail tab={tab} profile={profile} />
            </div>
          </div>
        </SectionOpenProvider>

        <IconPickerModal
          open={!!iconPickerTarget}
          iconQuery={iconQuery}
          onQueryChange={setIconQuery}
          filteredIcons={filteredIcons}
          onSelect={applyIconCode}
          onClose={() => {
            setIconPickerTarget(null)
            setIconQuery('')
          }}
        />
      </div>
    </div>
  )
}
