import AdminBackdrop from '@/components/admin/AdminBackdrop'

/**
 * The shared whiteboard's page (`/whiteboard/<slug|id>`), outside `(admin)` on purpose.
 *
 * `(admin)` means owner-only surfaces: its layout is `noindex` for the owner and draws
 * `AdminHomeLink`, a way into a hub a visitor cannot open. A share link is the one place the
 * owner's canvas is shown to someone else, so it gets its own group - with the same root
 * class and backdrop as `AdminChrome`, which is what makes the board look exactly like the
 * owner's, and without the home link.
 */
export default function SharedWhiteboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="portfolio-public-root clip-decorations relative flex min-h-screen flex-col text-pp-text">
      <AdminBackdrop />
      <div className="relative flex-1">{children}</div>
    </div>
  )
}
