import type { Metadata } from 'next'

/**
 * Exists only to give `/admin/settings` a title.
 *
 * `page.tsx` beside this is `'use client'`, and a client component cannot export `metadata`.
 * Until D6 that did not matter: `(admin)/layout.tsx` hardcoded `title: 'Settings'`, so this
 * page got the right tab label by accident and its three sibling boards got the wrong one.
 * Removing that default fixed the siblings and left this page as the one that had been
 * relying on it, so the title moves here - to the only segment it was ever true of.
 *
 * A layout rather than converting the page to a server shell: the page is one large client
 * island with its own state, and splitting it to move four lines of metadata would be a real
 * refactor in service of a tab label.
 */
export const metadata: Metadata = {
  title: 'Settings',
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
