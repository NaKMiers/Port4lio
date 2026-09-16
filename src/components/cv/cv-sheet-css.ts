/**
 * The `/cv` stylesheet, split by what each consumer is allowed to inject.
 *
 * `CvSheets` renders the same A4 sheets in two places now: the public `/cv` route and the
 * settings editor's live preview. The editor is a completely different document, so the
 * half of this stylesheet that talks about the *page* - the viewport background, the
 * floating download button, `@page`, `@media print` - must not travel with the sheets.
 * Injecting `@page` into `/settings` would silently redefine what Ctrl+P does on the whole
 * editor, and the responsive `zoom` rules would multiply against the preview's own scale.
 *
 * Every selector here is scoped under `.cv`. The class names the sheet uses internally are
 * short and generic - `.p`, `.sec`, `.name`, `.role`, `.date` - which is fine on a route
 * that owns its document, and a collision waiting to happen inside the admin app.
 */

/** PDF unit (893u = 210mm) -> CSS pt. */
export const u = (v: number) => `${((v * 2) / 3).toFixed(3)}pt`

/** One A4 width in CSS px (210mm at 96dpi), for scale-to-fit maths. */
export const SHEET_WIDTH_PX = 793.7

/**
 * Sheet geometry and typography: everything needed to render an A4 sheet correctly,
 * and nothing that assumes it owns the document.
 *
 * `.cv` here carries only the typographic invariants. Kerning and ligatures stay off
 * because the source lays glyphs out on raw advance widths - leaving either on makes
 * every line creep a few tenths of a percent short.
 */
export const CV_SHEET_CSS = `
@font-face {
  font-family: 'Glacial Indifference CV';
  src: url('/cv/glacial-indifference-bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: block;
}

.cv {
  --ink: #535353;
  font-family: var(--cv-body), Arimo, Arial, Helvetica, sans-serif;
  font-kerning: none;
  font-variant-ligatures: none;
  font-feature-settings: 'kern' 0, 'liga' 0, 'clig' 0;
  -webkit-font-smoothing: antialiased;
}

.cv .sheet {
  position: relative;
  width: 210mm;
  height: 297mm;
  margin: 0 auto 28px;
  padding: 0 ${u(50)};
  overflow: hidden;
  border-radius: 8px;
  background: #f9f9f9;
  color: var(--ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16), 0 12px 34px rgba(0, 0, 0, 0.1);
}
.cv .sheet:last-of-type { margin-bottom: 0; }
.cv .sheet * { box-sizing: border-box; }
.cv .sheet b { font-weight: 700; }

/* ---- masthead (page 1) ---------------------------------------------------- */
.cv .mast { position: relative; height: ${u(181)}; margin-top: ${u(46.05)}; }
.cv .mast > * { position: absolute; }

.cv .name {
  font-family: 'Glacial Indifference CV', var(--cv-body), Arial, sans-serif;
  font-weight: 700;
  font-size: 26.667pt;
  line-height: 32pt;
  letter-spacing: 1.187pt;
  color: #111111;
}

.cv .role {
  font-size: 14.667pt;
  line-height: 16.387pt;
  letter-spacing: 1.533pt;
}

.cv .rule { height: 1px; background: var(--ink); }

.cv .contact {
  font-size: 10pt;
  line-height: 14.667pt;
  margin-top: -1.747pt;
}

/* Vector pipe between contact items. */
.cv .bar {
  display: inline-block;
  position: relative;
  top: 0.45pt;
  width: 1px;
  height: 14.4pt;
  background: var(--ink);
  vertical-align: top;
}

/* ---- blocks --------------------------------------------------------------- */
.cv .sec {
  display: flex;
  align-items: center;
  font-family: 'Glacial Indifference CV', var(--cv-body), Arial, sans-serif;
  font-weight: 700;
  font-size: 12pt;
  line-height: ${u(22)};
  color: #000000;
}
/* The source pads each heading with four spaces before the rule starts. */
.cv .sec span { flex: 1 1 auto; height: 1px; margin-left: 12pt; background: var(--ink); }

.cv .p { font-size: 10pt; line-height: ${u(23.5)}; }

/* Skill grids run on a wider 29u leading. */
.cv .sk { font-size: 10pt; line-height: ${u(29)}; }
.cv .sk > div { display: flex; justify-content: space-between; }

/* Vertical grid. Each value is (target glyph-top gap) minus the previous block's
   trailing leading, minus the next block's half-leading. */
.cv .gFirst { margin-top: ${u(23.75)}; }  /* masthead      -> first heading */
.cv .gHead  { margin-top: ${u(19.671)}; } /* body          -> heading       */
.cv .gHeadS { margin-top: ${u(16.921)}; } /* skill row     -> heading       */
.cv .gBody  { margin-top: ${u(14.829)}; } /* heading       -> body          */
.cv .gSkill { margin-top: ${u(12.079)}; } /* heading       -> skill row     */
.cv .gProj  { margin-top: ${u(10.5)}; }   /* project       -> project       */
.cv .gTop   { margin-top: ${u(42.629)}; } /* page 2 top    -> first body    */

/* Bullet indents. Level 1 text sits 26.5u in from the margin, level 2 at 51.5u. */
.cv .ind1 { padding-left: ${u(26.5)}; }
.cv .ind2 { padding-left: ${u(51.5)}; }

.cv .jt { text-align: justify; }
.cv .hd { display: flex; justify-content: space-between; }
.cv .date { font-style: italic; color: #1545b4; }

.cv .i1, .cv .i2 { position: relative; }
.cv .i1::before,
.cv .i2::before {
  content: '';
  position: absolute;
  top: 6.56pt;
  border-radius: 50%;
}
.cv .i1::before { left: -10.6pt; width: 2.6pt; height: 2.6pt; background: var(--ink); }
.cv .i2::before { left: -11.43pt; width: 3.6pt; height: 3.6pt; border: 1px solid var(--ink); }

/* Every rule on this sheet is a 1px box filled with a background rather than a border -
   the masthead rule, the rule trailing each section heading, the vector pipes between
   contact items - and the level-1 bullet is a background disc. Browsers omit backgrounds
   when printing, and Chrome's print dialog ships with "Background graphics" off, so an
   exported PDF lost every divider and every level-1 bullet while the level-2 rings, drawn
   with a border, came through fine.

   Scoped to these four selectors rather than set on .cv itself: the sheet's own #f9f9f9
   must keep printing white, and forcing exact colour on the whole subtree would lay a
   grey panel under both pages. */
.cv .rule,
.cv .sec span,
.cv .bar,
.cv .i1::before {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Two class selectors, not one: the settings page carries \`portfolio-public-root\`, whose
   \`.portfolio-public-root a\` rule would otherwise outrank a bare \`.ul\` and repaint every
   link in the preview. */
.cv .ul, .cv .lnk {
  text-decoration: underline;
  text-underline-offset: 1.2pt;
  text-decoration-thickness: 0.75pt;
}
.cv .ul { color: inherit; }
.cv .lnk { color: #0c57fa; }
`

/**
 * Turns a `print()` call from inside the settings editor into a clean 2-page A4 PDF.
 *
 * Injected imperatively for the duration of one print and removed afterwards, never left in
 * the document. That is deliberate: `@page` cannot be scoped to a selector, so a permanent
 * copy of this rule would silently redefine Ctrl+P for the whole editor. Scoping it in time
 * instead of by selector keeps normal printing of `/settings` untouched.
 *
 * `.cv-print-root` is portaled to `document.body` (see `CvTabPreview`), so it is always a
 * direct child of `body` here - never nested inside the settings page's own layout. That is
 * what lets this rule `display: none` every OTHER direct child outright: the hidden-but-still
 * laid-out settings page (thousands of px tall) cannot pad the PDF with blank pages, and the
 * print root does not need `position: absolute` gymnastics to escape it.
 */
export const CV_PREVIEW_PRINT_CSS = `
@media print {
  body.cv-printing > *:not(.cv-print-root) { display: none !important; }

  body.cv-printing .cv-print-root {
    position: static !important;
    margin: 0 !important;
    width: 210mm !important;
    zoom: 1 !important;
  }
  body.cv-printing .cv-print-root .sheet {
    margin: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  body.cv-printing .cv-print-root .sheet + .sheet { break-before: page !important; }

  @page { size: A4; margin: 0; }
}
`

/**
 * Route chrome: the things that are only true when the sheets ARE the page.
 *
 * Injected by `/cv` alone. `@page` and the `@media print` block are document-global, and
 * the responsive `zoom` rules key off viewport width, so both would misbehave inside the
 * editor's fixed-width preview rail.
 */
export const CV_ROUTE_CSS = `
.cv {
  min-height: 100vh;
  padding: 28px 16px;
  overflow-x: auto;
  background: #e8e8e8;
}

/* ---- floating print action (screen only) ----------------------------------- */
.dl {
  /* Was an <a>, now a <button> - reset the UA chrome the anchor never had. */
  appearance: none;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 12px 20px 12px 17px;
  border-radius: 999px;
  background: #1f1f1f;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.01em;
  text-decoration: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2), 0 12px 28px rgba(0, 0, 0, 0.24);
  transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.dl:hover { transform: translateY(-2px); background: #000000; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.22), 0 16px 34px rgba(0, 0, 0, 0.28); }
.dl:active { transform: translateY(0); }
.dl:focus-visible { outline: 2px solid #0c57fa; outline-offset: 3px; }
.dl svg { display: block; width: 17px; height: 17px; }

@media (prefers-reduced-motion: reduce) { .dl { transition: none; } .dl:hover { transform: none; } }
@media screen and (max-width: 540px) { .dl { right: 16px; bottom: 16px; padding: 10px 16px 10px 13px; font-size: 13px; } }

/* Ctrl+P reproduces the sheets exactly. */
@page { size: A4; margin: 0; }
@media print {
  .cv { padding: 0; background: #ffffff; overflow: visible; }
  .cv .sheet { margin: 0; border-radius: 0; box-shadow: none; }
  /* break-before on the follower, so trailing non-sheet children (the download
     button) can never spill onto a blank extra page. */
  .cv .sheet + .sheet { break-before: page; }
  .dl { display: none; }
}

/* Scale the sheet down on narrow viewports; the layout itself never changes.
   Screen-only — print must always render the sheet at true A4. */
@media screen and (max-width: 900px) { .cv .sheet { zoom: 0.86; } }
@media screen and (max-width: 780px) { .cv .sheet { zoom: 0.72; } }
@media screen and (max-width: 660px) { .cv .sheet { zoom: 0.58; } }
@media screen and (max-width: 540px) { .cv .sheet { zoom: 0.46; } }
@media screen and (max-width: 430px) { .cv .sheet { zoom: 0.37; } }
`
