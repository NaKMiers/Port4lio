import PortfolioBackdropOrnaments from '@/components/portfolio/PortfolioBackdropOrnaments'

/**
 * The admin background: the public site's backdrop, plus the blur wash.
 *
 * ## Why it reuses `PortfolioBackdropOrnaments` rather than defining its own shapes
 *
 * The brief was "make it similar to the home page", and the cheapest way to be similar to
 * the home page is to be the home page. A second set of hand-placed ornaments would drift
 * from the first the moment either is touched, and there is no reason for the owner's
 * surfaces to have their own vocabulary of floating shapes.
 *
 * ## The blur blobs
 *
 * Three soft colour pools behind everything, lifted verbatim from what `/admin/settings`
 * used to render inline. They were correct and they were in one file; every other owner
 * board rendered only the grid wash, so the settings editor looked like a different product
 * from the publish board. They live here now and every admin page gets them.
 *
 * Kept OUTSIDE `PortfolioBackdropOrnaments` deliberately: that component's decorations are
 * grouped under `.pp-decorations` so a page can opt out with `data-plain`, and the blur is
 * background rather than furniture - a page that drops the drifting shapes should keep it.
 */
export default function AdminBackdrop() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden
      >
        <div className="absolute -left-16 top-32 h-48 w-48 rounded-full bg-pp-orange/15 blur-3xl" />
        <div className="absolute right-0 top-20 h-64 w-64 rounded-full bg-pp-blue/10 blur-3xl" />
        <div className="absolute left-1/3 top-[55%] h-52 w-52 rounded-full bg-pp-pink/10 blur-3xl" />
        <div className="absolute -right-10 bottom-24 h-56 w-56 rounded-full bg-pp-violet/10 blur-3xl" />
        <div className="absolute bottom-10 left-[8%] h-44 w-44 rounded-full bg-pp-green/10 blur-3xl" />
      </div>
      <PortfolioBackdropOrnaments />
    </>
  )
}
