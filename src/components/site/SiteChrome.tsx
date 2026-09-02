import { Suspense } from 'react'

import Header from '@/components/Header'
import Nav from '@/components/Nav'
import ProfileFetchStatus from '@/components/ProfileFetchStatus'

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className='page text-white font-sora relative'>
      <Suspense fallback={<div className='fixed xl:right-[2%] z-50 xl:w-16 h-[60px]' />}>
        <Nav />
      </Suspense>
      <Header />
      <ProfileFetchStatus />
      {children}
    </div>
  )
}
