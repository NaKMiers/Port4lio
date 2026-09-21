import { PortfolioExternalLink } from '@/components/portfolio/primitives/PortfolioExternalLink'
import { PORTFOLIO_NAV_SECTIONS } from '@/lib/portfolio-section-nav'
import {
  collapseWhitespace,
  sanitizeSocialLinks,
  trimText,
} from '@/lib/profile-copy'
import type { Profile } from '@/types/profile'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

type FooterSectionProps = {
  profile: Profile
}

function isUsableCvUrl(raw: string): boolean {
  const t = trimText(raw)
  if (!t) return false
  return /^https?:\/\//i.test(t) || t.startsWith('/')
}

/**
 * Site footer: section shortcuts (hash links), outbound surfaces, copyright.
 * Matches one-page anchors used by `FloatingSectionNav` and `/?section=` legacy redirects.
 */
export default function FooterSection({ profile }: FooterSectionProps) {
  const year = new Date().getFullYear()
  const owner =
    collapseWhitespace(profile.fullName) ||
    trimText(profile.username) ||
    'Portfolio'

  const socials = sanitizeSocialLinks(profile.socials ?? [])
  const cvRaw = profile.cv?.trim() ?? ''
  const showCv = isUsableCvUrl(cvRaw)

  return (
    <footer
      className={cx(
        'scroll-mt-24 border-t border-pp-line bg-gradient-to-b from-transparent to-[rgba(255,253,250,0.65)]',
        'pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-14'
      )}
    >
      <div className="mx-auto w-full max-w-editorial px-gutter">
        <div className="grid gap-12 border-b border-pp-line/80 pb-12 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-14">
          <div className="space-y-4">
            <p className="font-display text-lg font-semibold tracking-tight text-pp-text">
              {owner}
            </p>
            <p className="max-w-md text-sm leading-relaxed text-pp-muted">
              Editorial portfolio - jump to any section or use the contact form
              above.
            </p>
          </div>

          <nav
            aria-label="Footer section links"
            className="md:text-right"
          >
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
              On this page
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 md:justify-end">
              {PORTFOLIO_NAV_SECTIONS.map(({ id, label }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-sm font-semibold text-pp-text underline decoration-pp-blue/35 underline-offset-[0.2em] transition-colors hover:decoration-pp-blue"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex flex-col gap-8 pt-10 md:flex-row md:items-center md:justify-between">
          <div className="text-xs text-pp-muted">
            © {year} {owner}. All rights reserved.
          </div>

          {(socials.length > 0 || showCv) && (
            <div className="flex flex-wrap items-center gap-3 md:justify-end">
              {socials.map((s, i) => (
                <PortfolioExternalLink
                  key={`foot-social-${i}-${s.link}`}
                  href={s.link}
                  className="inline-flex min-h-[40px] items-center rounded-full border border-pp-line bg-pp-panel/85 px-4 py-2 text-xs font-semibold text-pp-text shadow-[0_1px_0_rgba(31,28,26,0.04)] backdrop-blur-sm hover:bg-pp-panel-strong"
                >
                  {s.name || 'Social'}
                </PortfolioExternalLink>
              ))}
              {showCv ? (
                <PortfolioExternalLink
                  href={cvRaw}
                  className="inline-flex min-h-[40px] items-center rounded-full border border-dashed border-pp-line bg-pp-panel-strong/90 px-4 py-2 text-xs font-semibold text-pp-text"
                >
                  CV
                </PortfolioExternalLink>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </footer>
  )
}
