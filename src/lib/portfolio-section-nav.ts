/**
 * Canonical one-page anchors - keep in sync with section `id`s and legacy `/?section=` redirects.
 */
export const PORTFOLIO_NAV_SECTIONS = [
  { id: 'hero', label: 'Intro' },
  { id: 'about', label: 'About' },
  { id: 'services', label: 'Services' },
  { id: 'work', label: 'Work' },
  { id: 'testimonials', label: 'Proof' },
  { id: 'contact', label: 'Contact' },
] as const

export type PortfolioNavSectionId =
  (typeof PORTFOLIO_NAV_SECTIONS)[number]['id']

export const PORTFOLIO_NAV_SECTION_ID_SET = new Set<string>(
  PORTFOLIO_NAV_SECTIONS.map(s => s.id)
)
