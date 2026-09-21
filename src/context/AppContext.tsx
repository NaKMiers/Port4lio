'use client'

import { Profile } from '@/types/profile'
import { normalizeProfile } from '@/lib/profile'
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from 'react'

interface AppContextProps {
  profile: Profile | null
  setProfile: (profile: Profile) => void
  loading: boolean
  error: string | null
  refetchProfile: (options?: { blocking?: boolean }) => Promise<void>
}

const AppContext = createContext<AppContextProps | null>(null)

function AppProvider({
  children,
  initialProfile,
  bootstrapOnMount,
  endpoint = '/api/profile',
}: {
  children: ReactNode
  initialProfile?: Profile | null
  bootstrapOnMount?: boolean
  /**
   * Where to read the profile from. Defaults to the public, allowlisted endpoint. The
   * admin tree passes `/api/admin/profile` so the editor can see private fields.
   */
  endpoint?: string
}) {
  const [profile, setProfileState] = useState<Profile | null>(
    initialProfile ?? null
  )
  const [loading, setLoading] = useState(!initialProfile && !!bootstrapOnMount)
  const [error, setError] = useState<string | null>(null)

  const setProfile = (nextProfile: Profile) => {
    setProfileState(normalizeProfile(nextProfile))
  }

  const refetchProfile = async (options?: { blocking?: boolean }) => {
    const shouldBlock = options?.blocking ?? !profile

    try {
      if (shouldBlock) setLoading(true)

      setError(null)
      const response = await fetch(endpoint)
      const data = await response.json()
      if (response.status === 401) {
        // Not signed in yet. That is a state, not a failure - the owner gate is about to
        // render the login form, and an error banner above it would just be noise.
        setProfileState(null)
        return
      }
      if (!response.ok)
        throw new Error(data?.error || 'Failed to fetch profile')

      setProfileState(data?.profile ? normalizeProfile(data.profile) : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch profile')
      if (shouldBlock) setProfileState(null)
    } finally {
      if (shouldBlock) setLoading(false)
    }
  }

  const runBootstrapFetch = useEffectEvent(() => {
    void refetchProfile({ blocking: true })
  })

  useEffect(() => {
    if (!bootstrapOnMount || initialProfile) return

    const timer = window.setTimeout(() => {
      runBootstrapFetch()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [bootstrapOnMount, initialProfile])

  return (
    <AppContext.Provider
      value={{ profile, setProfile, loading, error, refetchProfile }}
    >
      {children}
    </AppContext.Provider>
  )
}

export default AppProvider

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context)
    throw new Error('useAppContext must be used within an AppProvider')

  return context
}
