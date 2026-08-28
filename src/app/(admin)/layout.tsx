import type { Metadata } from 'next'

import AppProvider from '@/context/AppContext'
import SiteChrome from '@/components/site/SiteChrome'

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider bootstrapOnMount endpoint='/api/admin/profile'>
      <SiteChrome>{children}</SiteChrome>
    </AppProvider>
  )
}
