import { Suspense } from 'react'

import Header from '@/components/Header'
import Nav from '@/components/Nav'
import ProfileFetchStatus from '@/components/ProfileFetchStatus'

export default function SiteChrome({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="page relative font-sora text-white">
      <Suspense
        fallback={<div className="fixed z-50 h-[60px] xl:right-[2%] xl:w-16" />}
      >
        <Nav />
      </Suspense>
      <Header />
      <ProfileFetchStatus />
      {children}
    </div>
  )
}
