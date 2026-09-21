# Frontend UI Rules

Preserve a polished, practical product feel: calm layout, strong hierarchy,
clear actions, responsive by default, and reusable component primitives.

## Visual Foundation

- Use Tailwind/CSS tokens before one-off colors.
- Default typography follows the newer projects: Montserrat for display/sans
  and Source Sans for body when the product design does not specify otherwise.
- Prefer a small semantic palette: `background`, `primary`, `dark-primary`,
  `secondary`, `light`, `dark`, `light-gray`, and `dark-gray`, then add domain
  colors intentionally.
- Keep custom spacing like `21px` and `10.5px` available through tokens when it
  improves rhythm.
- Avoid broad redesigns while fixing behavior.

## Components

- Shared components live in `src/components`.
- Put basic primitives in `src/components/ui`, cross-feature helpers in
  `src/components/common`, and product sections in domain folders.
- Component files should export a focused component with a nearby `Props`
  interface.
- Accept `className?: string` on reusable visual components and merge it with
  `cn(...)`.
- Use `memo(...)` for stable reusable components when it matches the existing
  pattern and props are simple.
- Prefer `next/image` and `next/link` in web UI.
- Prefer `lucide-react` icons for common actions when available.

## Tailwind And Layout

- Compose responsive layouts with Tailwind utilities and semantic tokens.
- Keep class names readable with `cn(...)`, not long nested ternaries.
- Use stable dimensions for fixed-format UI such as buttons, tiles, toolbars,
  counters, and cards to avoid layout shift.
- Ensure text fits on mobile and desktop. Avoid tiny text as the only fix for
  overflow.
- Do not use clickable `div`s when a real `button` or `Link` is correct.

## Loading, Empty, And Error States

- Add route-level `loading.tsx` or component-level loading UI for slow pages.
- Put reusable loading skeletons in `src/components/loading`.
- Empty states should explain the state and offer the next useful action.
- Client actions should show useful feedback through the project's toast system
  once one is installed.

## Copy And Accessibility

- Keep product copy intentional and user-facing copy consistent in language and
  tone.
- Do not replace existing Vietnamese or localized copy unless requested.
- Use clear `alt` text for meaningful images; decorative images should be
  safely hidden or empty-alt as appropriate.
- Preserve disabled, focus, hover, and loading states.
