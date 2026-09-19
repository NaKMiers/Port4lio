'use client'

import { Sparkles } from 'lucide-react'

/**
 * The one button on `/admin/blog` that does not look like the others, on purpose.
 *
 * ```
 *   [ new-slug ......................... ]  [ Create draft ]  [ ✨ Generate blog ]
 *                                              flat, dark        aurora + sheen
 * ```
 *
 * ## Why it gets its own styling instead of `primaryBtnCls`
 *
 * Every other control on this board does a small, cheap, reversible thing: create an empty
 * draft, archive a row, open an editor. This one spends money at a third party, takes up to
 * ninety seconds, and writes a whole post. A button that looks identical to "Create draft"
 * while behaving nothing like it is the button people press by accident - so the visual
 * distance is the affordance, not the decoration.
 *
 * ## The hover animation, and the two things it deliberately does not do
 *
 * The sheen runs ONCE per hover (`animate-sheen-sweep`, no `infinite`) and the aurora drift
 * underneath is slow enough to read as a gradient rather than as motion. A control that
 * shimmers continuously in the corner of an admin page is an advertisement competing with the
 * content for attention, every second, forever - and this page's actual job is to show the
 * owner how long it has been since they published.
 *
 * `motion-reduce:animate-none` on both. `prefers-reduced-motion` is set by people for whom
 * this kind of movement causes symptoms, and a sweeping highlight behind text is squarely the
 * kind it covers. The gradient, the lift and the ring all survive, so the button still reads
 * as the special one without moving at all.
 *
 * ## Why the sheen is a sibling span and not a `::before`
 *
 * It needs `overflow-hidden` on the button and a transform on itself. As a pseudo-element
 * that is an arbitrary-variant stack (`before:content-[''] before:absolute ...`) long enough
 * that nobody would edit it twice; as a real element it is four classes and `aria-hidden`.
 */
export default function GenerateBlogButton({
  onClick,
  disabled = false,
  label = 'Generate blog',
}: {
  onClick: () => void
  disabled?: boolean
  /**
   * "Generate blog" on the board, "Regenerate post" in the editor.
   *
   * A prop rather than two components, because the styling IS the message - this is the
   * expensive, slow, model-backed control - and the two callers are the same kind of action at
   * different stages. Two copies would drift on the one thing that has to stay identical.
   */
  label?: string
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={[
        'group relative isolate inline-flex items-center gap-2 overflow-hidden rounded-full px-5 py-3',
        'text-sm font-semibold text-white',
        // `bg-[length:200%_200%]` is what `aurora-drift` animates against - a background
        // position cannot travel across a gradient that is exactly the element's size.
        'bg-[linear-gradient(115deg,#241f1c,#4b3a6e_28%,#1f4f6b_52%,#6b3a5a_74%,#241f1c)] bg-[length:200%_200%]',
        'animate-aurora-drift motion-reduce:animate-none',
        'shadow-[0_18px_34px_rgba(43,30,66,0.28)] ring-1 ring-white/12 transition duration-300',
        'hover:-translate-y-0.5 hover:shadow-[0_26px_46px_rgba(43,30,66,0.36)] hover:ring-white/25',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pp-blue/60',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0',
      ].join(' ')}
    >
      <span
        aria-hidden
        className='pointer-events-none absolute inset-y-0 -left-1/3 -z-10 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.42),transparent)] opacity-0 group-hover:opacity-100 group-hover:animate-sheen-sweep motion-reduce:group-hover:animate-none'
      />
      <Sparkles
        aria-hidden
        size={16}
        className='transition duration-300 group-hover:rotate-12 group-hover:scale-110 motion-reduce:transform-none'
      />
      {label}
    </button>
  )
}
