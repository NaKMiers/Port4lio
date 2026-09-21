import { EditorialPanel } from '@/components/portfolio/primitives/EditorialPanel'
import { PortfolioExternalLink } from '@/components/portfolio/primitives/PortfolioExternalLink'
import { SectionFrame } from '@/components/portfolio/primitives/SectionFrame'
import {
  collapseWhitespace,
  sanitizeSocialLinks,
  trimText,
} from '@/lib/profile-copy'
import type { Profile } from '@/types/profile'
import { resolveIconFromCode } from '@/utils/iconResolver'

import PortfolioContactForm from './PortfolioContactForm'

const cx = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ')

const eyebrowCls =
  'text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'

type ContactSectionProps = {
  profile: Profile
}

function isUsableCvUrl(raw: string): boolean {
  const t = trimText(raw)
  if (!t) return false
  return /^https?:\/\//i.test(t) || t.startsWith('/')
}

function SocialSurface({
  name,
  iconCode,
  href,
}: {
  name: string
  iconCode: string
  href: string
}) {
  const iconNode = resolveIconFromCode(iconCode, 18, 'text-pp-text')
  const preview = href
    .replace(/^https?:\/\//i, '')
    .replace(/^mailto:/i, '')
    .replace(/^tel:/i, '')

  return (
    <PortfolioExternalLink
      href={href}
      className={cx(
        'group flex items-center gap-3 rounded-panel border border-pp-line bg-pp-panel/90 px-4 py-3 shadow-panel backdrop-blur-md',
        'motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_12px_36px_rgba(46,35,28,0.1)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-pp-line bg-pp-panel-strong text-lg leading-none text-pp-text">
        {iconNode}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-pp-text underline decoration-pp-blue/35 underline-offset-[0.2em] group-hover:decoration-pp-blue">
          {name}
        </span>
        <span className="block truncate text-xs text-pp-muted">{preview}</span>
      </span>
    </PortfolioExternalLink>
  )
}

/**
 * Closing band: curated outbound links from profile data + the existing POST `/api/contact` flow.
 */
export default function ContactSection({ profile }: ContactSectionProps) {
  const socials = sanitizeSocialLinks(profile.socials ?? [])
  const cvHref = profile.cv?.trim() ?? ''
  const showCv = isUsableCvUrl(cvHref)

  const displayName =
    collapseWhitespace(profile.fullName) ||
    (profile.username ? `@${profile.username.trim()}` : '')

  return (
    <SectionFrame
      id="contact"
      aria-labelledby="contact-heading"
      className="scroll-mt-24 border-b border-pp-line md:scroll-mt-28"
    >
      <div className="space-y-10 md:space-y-12">
        <header className="max-w-3xl space-y-3">
          <p className={eyebrowCls}>Contact</p>
          <h2
            id="contact-heading"
            className="text-pretty font-display text-[clamp(1.65rem,3.6vw,2.35rem)] font-semibold leading-tight tracking-tight text-pp-text"
          >
            Start a conversation
          </h2>
          <p className="text-pretty font-editorial text-base leading-[1.75] text-pp-muted md:text-[1.0625rem] md:leading-[1.78]">
            {displayName ? (
              <>
                Reach out to {displayName} using the channels below, or send a
                message with the form - the same flow as the legacy contact
                experience.
              </>
            ) : (
              <>
                Use the channels below or send a message - the same flow as the
                legacy contact experience.
              </>
            )}
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14 xl:items-start">
          <div className="space-y-6">
            {(socials.length > 0 || showCv) && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-pp-text">
                  Elsewhere & documents
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  {socials.map((s, i) => {
                    return (
                      <li key={`social-${i}-${s.link}`}>
                        <SocialSurface
                          name={s.name || 'Link'}
                          iconCode={s.icon}
                          href={s.link}
                        />
                      </li>
                    )
                  })}
                  {showCv ? (
                    <li>
                      <PortfolioExternalLink
                        href={cvHref}
                        className={cx(
                          'flex min-h-[52px] items-center justify-center rounded-panel border border-dashed border-pp-line bg-pp-panel-strong/80 px-4 py-3 text-center text-sm font-semibold text-pp-text shadow-panel',
                          'motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:hover:-translate-y-0.5',
                          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue'
                        )}
                      >
                        View or download CV
                      </PortfolioExternalLink>
                    </li>
                  ) : null}
                </ul>
              </div>
            )}

            {socials.length === 0 && !showCv ? (
              <EditorialPanel className="p-5 text-sm leading-relaxed text-pp-muted">
                No social links configured yet - use the form to get in touch.
              </EditorialPanel>
            ) : null}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-pp-text">Message</h3>
            <PortfolioContactForm />
          </div>
        </div>
      </div>
    </SectionFrame>
  )
}
