import {
  Apple,
  Chrome,
  ExternalLink,
  Github,
  Globe,
  Instagram,
  Linkedin,
  Pin,
  Smartphone,
  Youtube,
} from 'lucide-react'

import RevealOnScroll from '@/components/portfolio/client/RevealOnScroll'
import type { SocialProofViewModel } from '@/lib/profile-view-model'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type SocialProofStripProps = {
  socialProof: SocialProofViewModel
}

function dedupeSurfaces(
  vm: SocialProofViewModel
): { name: string; url: string }[] {
  const map = new Map<string, { name: string; url: string }>()
  const ordered: { name: string; url: string }[] = []
  for (const item of [...vm.profiles, ...vm.storeLinks]) {
    const url = item.url.trim()
    const name = item.name.trim()
    if (!url || !name) continue
    const key = url.toLowerCase()
    if (map.has(key)) continue
    const row = { name, url }
    map.set(key, row)
    ordered.push(row)
  }
  return ordered
}

function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function ProofGlyph({ url }: { url: string }) {
  const u = url.toLowerCase()
  const cls = 'h-4 w-4 shrink-0 text-pp-muted'
  if (u.includes('github.com'))
    return (
      <Github
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('linkedin.com'))
    return (
      <Linkedin
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('youtube.com') || u.includes('youtu.be'))
    return (
      <Youtube
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('instagram.com'))
    return (
      <Instagram
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('pinterest.'))
    return (
      <Pin
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('twitter.com') || u.includes('x.com'))
    return (
      <Globe
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('zalo.me'))
    return (
      <Globe
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('facebook.com') || u.includes('fb.com'))
    return (
      <Globe
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('apps.apple.com') || u.includes('itunes.apple.com'))
    return (
      <Apple
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('play.google.com'))
    return (
      <Smartphone
        className={cls}
        aria-hidden
      />
    )
  if (u.includes('chrome.google.com/webstore'))
    return (
      <Chrome
        className={cls}
        aria-hidden
      />
    )
  return (
    <ExternalLink
      className={cls}
      aria-hidden
    />
  )
}

/**
 * Fast trust band using real social URLs and marketplace links mined from project payloads - no fabricated logos.
 */
export default function SocialProofStrip({
  socialProof,
}: SocialProofStripProps) {
  const surfaces = dedupeSurfaces(socialProof)
  if (!surfaces.length) return null

  return (
    <section
      aria-label="Social profiles and published surfaces"
      className="scroll-mt-24 border-t border-pp-line bg-gradient-to-b from-pp-panel/45 to-transparent py-section-sm md:scroll-mt-28"
    >
      <div className="mx-auto w-full max-w-editorial px-gutter">
        <RevealOnScroll variant="soft">
          <div className="flex flex-col gap-4">
            <p className="text-center font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-pp-muted">
              Seen across {surfaces.length} live surface
              {surfaces.length > 1 ? 's' : ''}
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {surfaces.map(({ name, url }) => {
                const external = isExternal(url)
                return (
                  <li key={url}>
                    <a
                      href={url}
                      className={cx(
                        'inline-flex min-h-[44px] items-center gap-2 rounded-full border border-pp-line bg-pp-panel-strong px-4 py-2 text-sm font-semibold text-pp-text shadow-[0_10px_30px_rgba(46,35,28,0.05)]',
                        'motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-panel',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
                      )}
                      {...(external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      <ProofGlyph url={url} />
                      <span>{name}</span>
                      {external ? (
                        <span className="sr-only"> (opens in a new tab)</span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        </RevealOnScroll>
      </div>
    </section>
  )
}
