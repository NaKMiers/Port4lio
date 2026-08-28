import type { Metadata } from 'next'
import { Arimo } from 'next/font/google'
import { Fragment } from 'react'
import type { ReactNode } from 'react'

import CvPrintButton from '@/components/cv/CvPrintButton'
import { loadPublicResume } from '@/lib/profile-data'
import { renderInlineBold } from '@/lib/resume-inline'
import type { ResumePrintItem } from '@/lib/resume-view-model'
import { deriveResume, planResumeSheets } from '@/lib/resume-view-model'
import type {
  ResumeCertificationBlock,
  ResumeContact,
  ResumeSkillBlock,
  ResumeTextBlock,
} from '@/types/profile'

/**
 * Data-driven 2 x A4 CV, typographically identical to the original `Globee Trainee.pdf`.
 *
 * Copy comes from `profile.resume` (see `deriveResume`); the geometry below is unchanged
 * from the hardcoded original. Sheets are `height: 297mm; overflow: hidden`, so content
 * that grows past the page is CLIPPED, not reflowed - `tests/e2e/cv-pagination.spec.ts`
 * is what turns that silent failure into a loud one.
 *
 * Geometry is expressed in the source document's own unit grid: **893u = 210mm** (one A4
 * width). `u()` converts a raw unit to `pt` (1u = 2/3pt).
 *
 * Typography is the real thing, not a lookalike:
 * - body  = Arimo (the face the PDF embeds; metric-clone of Arial) via next/font
 * - heads = Glacial Indifference Bold (`public/cv/glacial-indifference-bold.woff2`)
 *
 * Blocks are laid out in normal flow on a fixed vertical grid rather than absolutely
 * positioned, so content can be edited without recomputing every coordinate. The grid:
 * body leading 23.5u, skill rows 29u, 40u between a section rule and its neighbours,
 * 34u between projects. The `g*` classes below carry those gaps with each block's
 * half-leading already subtracted.
 */

const arimo = Arimo({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--cv-body',
  display: 'swap',
})

export const revalidate = 60

export async function generateMetadata(): Promise<Metadata> {
  const resume = deriveResume({ resume: await loadPublicResume() })
  return {
    title: `${resume.name} — CV`,
    description: `${resume.role} — curriculum vitae of ${resume.name}.`,
  }
}

/** PDF unit (893u = 210mm) -> CSS pt. */
const u = (v: number) => `${((v * 2) / 3).toFixed(3)}pt`

const css = `
@font-face {
  font-family: 'Glacial Indifference CV';
  src: url('/cv/glacial-indifference-bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: block;
}

.cv {
  --ink: #535353;
  min-height: 100vh;
  padding: 28px 16px;
  overflow-x: auto;
  background: #e8e8e8;
  font-family: var(--cv-body), Arimo, Arial, Helvetica, sans-serif;
  /* The source lays glyphs out on raw advance widths — no GPOS kerning, no ligatures.
     Leaving either on makes every line creep a few tenths of a percent short. */
  font-kerning: none;
  font-variant-ligatures: none;
  font-feature-settings: 'kern' 0, 'liga' 0, 'clig' 0;
  -webkit-font-smoothing: antialiased;
}

.sheet {
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
.sheet:last-of-type { margin-bottom: 0; }
.sheet * { box-sizing: border-box; }
.sheet b { font-weight: 700; }

/* ---- masthead (page 1) ---------------------------------------------------- */
.mast { position: relative; height: ${u(181)}; margin-top: ${u(46.05)}; }
.mast > * { position: absolute; }

.name {
  font-family: 'Glacial Indifference CV', var(--cv-body), Arial, sans-serif;
  font-weight: 700;
  font-size: 26.667pt;
  line-height: 32pt;
  letter-spacing: 1.187pt;
  color: #111111;
}

.role {
  font-size: 14.667pt;
  line-height: 16.387pt;
  letter-spacing: 1.533pt;
}

.rule { height: 1px; background: var(--ink); }

.contact {
  font-size: 10pt;
  line-height: 14.667pt;
  margin-top: -1.747pt;
}

/* Vector pipe between contact items. */
.bar {
  display: inline-block;
  position: relative;
  top: 0.45pt;
  width: 1px;
  height: 14.4pt;
  background: var(--ink);
  vertical-align: top;
}

/* ---- blocks --------------------------------------------------------------- */
.sec {
  display: flex;
  align-items: center;
  font-family: 'Glacial Indifference CV', var(--cv-body), Arial, sans-serif;
  font-weight: 700;
  font-size: 12pt;
  line-height: ${u(22)};
  color: #000000;
}
/* The source pads each heading with four spaces before the rule starts. */
.sec span { flex: 1 1 auto; height: 1px; margin-left: 12pt; background: var(--ink); }

.p { font-size: 10pt; line-height: ${u(23.5)}; }

/* Skill grids run on a wider 29u leading. */
.sk { font-size: 10pt; line-height: ${u(29)}; }
.sk > div { display: flex; justify-content: space-between; }

/* Vertical grid. Each value is (target glyph-top gap) minus the previous block's
   trailing leading, minus the next block's half-leading. */
.gFirst { margin-top: ${u(23.75)}; }  /* masthead      -> first heading */
.gHead  { margin-top: ${u(19.671)}; } /* body          -> heading       */
.gHeadS { margin-top: ${u(16.921)}; } /* skill row     -> heading       */
.gBody  { margin-top: ${u(14.829)}; } /* heading       -> body          */
.gSkill { margin-top: ${u(12.079)}; } /* heading       -> skill row     */
.gProj  { margin-top: ${u(10.5)}; }   /* project       -> project       */
.gTop   { margin-top: ${u(42.629)}; } /* page 2 top    -> first body    */

/* Bullet indents. Level 1 text sits 26.5u in from the margin, level 2 at 51.5u. */
.ind1 { padding-left: ${u(26.5)}; }
.ind2 { padding-left: ${u(51.5)}; }

.jt { text-align: justify; }
.hd { display: flex; justify-content: space-between; }
.date { font-style: italic; color: #1545b4; }

.i1, .i2 { position: relative; }
.i1::before,
.i2::before {
  content: '';
  position: absolute;
  top: 6.56pt;
  border-radius: 50%;
}
.i1::before { left: -10.6pt; width: 2.6pt; height: 2.6pt; background: var(--ink); }
.i2::before { left: -11.43pt; width: 3.6pt; height: 3.6pt; border: 1px solid var(--ink); }

.ul, .lnk {
  text-decoration: underline;
  text-underline-offset: 1.2pt;
  text-decoration-thickness: 0.75pt;
}
.ul { color: inherit; }
.lnk { color: #0c57fa; }

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
  .sheet { margin: 0; border-radius: 0; box-shadow: none; }
  /* break-before on the follower, so trailing non-sheet children (the download
     button) can never spill onto a blank extra page. */
  .sheet + .sheet { break-before: page; }
  .dl { display: none; }
}

/* Scale the sheet down on narrow viewports; the layout itself never changes.
   Screen-only — print must always render the sheet at true A4. */
@media screen and (max-width: 900px) { .sheet { zoom: 0.86; } }
@media screen and (max-width: 780px) { .sheet { zoom: 0.72; } }
@media screen and (max-width: 660px) { .sheet { zoom: 0.58; } }
@media screen and (max-width: 540px) { .sheet { zoom: 0.46; } }
@media screen and (max-width: 430px) { .sheet { zoom: 0.37; } }
`

/**
 * Hand-measured gaps around the vector pipes in the masthead, in source units.
 *
 * Each value is tuned to the glyph advances of the specific strings on either side, so
 * CHANGING THE CONTACT COPY REQUIRES RE-MEASURING THESE. The overflow test cannot catch a
 * mismatch here - it only sees height. Rows longer than the list reuse the last gap.
 */
const CONTACT_BAR_GAPS = {
  identity: [
    { left: 12.58, right: 13.68 },
    { left: 11.8, right: 14.16 },
  ],
  links: [
    { left: 2.8, right: 3.66 },
    { left: 3.08, right: 4.68 },
  ],
} as const

type BarGap = { left: number; right: number }

function barGap(gaps: readonly BarGap[], index: number): BarGap {
  return gaps[index] ?? gaps[gaps.length - 1] ?? { left: 12, right: 13 }
}

function Bar({ gap }: { gap: BarGap }) {
  return <span className='bar' style={{ marginLeft: u(gap.left), marginRight: u(gap.right) }} />
}

/** Joins nodes with a separator, without introducing a wrapper element. */
function joinNodes(nodes: ReactNode[], separator: string): ReactNode[] {
  return nodes.flatMap((node, index) =>
    index === 0 ? [node] : [<span key={`sep-${index}`}>{separator}</span>, node]
  )
}

function ContactRow({ contact }: { contact: ResumeContact }) {
  const identity = [contact.email, contact.phone, contact.location].filter(Boolean)

  return (
    <div className='contact' style={{ left: u(233), top: u(138.95) }}>
      <div>
        {identity.map((value, index) => (
          <span key={value}>
            {index > 0 && <Bar gap={barGap(CONTACT_BAR_GAPS.identity, index - 1)} />}
            {value}
          </span>
        ))}
      </div>
      <div>
        {contact.links.map((link, index) => (
          <span key={link.href || link.text}>
            {index > 0 && <Bar gap={barGap(CONTACT_BAR_GAPS.links, index - 1)} />}
            {link.label ? `${link.label}: ` : ''}
            <a className='ul' href={link.href}>
              <b>{link.text}</b>
            </a>
          </span>
        ))}
      </div>
    </div>
  )
}

function SectionRule({ heading, gap }: { heading: string; gap: string }) {
  return (
    <div className={`sec ${gap}`}>
      {heading}
      <span />
    </div>
  )
}

function TextBlock({ block, justify }: { block: ResumeTextBlock; justify?: boolean }) {
  return (
    <div className={`p gBody${justify ? ' jt' : ''}`}>
      {block.lines.map((line, index) => (
        <div key={index}>{renderInlineBold(line)}</div>
      ))}
    </div>
  )
}

function SkillRows({ block }: { block: ResumeSkillBlock }) {
  return (
    <div className='sk gSkill'>
      {block.rows.map((row, index) => (
        <div key={index}>
          {row.items.map(item => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

function CertificationBody({ block }: { block: ResumeCertificationBlock }) {
  return (
    <div className='p gBody'>
      {block.groups.map((group, index) => (
        <div key={index}>
          {group.issuer && <b>{`${group.issuer}: `}</b>}
          {joinNodes(
            group.items.map(item => (
              <a className='ul' key={item.link || item.name} href={item.link}>
                {item.name}
              </a>
            )),
            ' · '
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * One printed block from the project stream. `gTop` replaces the block's own leading gap
 * on the first item of sheet 2, matching the source's page-2 top margin.
 */
function PrintItem({ item, gTop }: { item: ResumePrintItem; gTop: boolean }) {
  switch (item.kind) {
    case 'sectionHeading':
      return <SectionRule heading={item.text} gap={gTop ? 'gTop' : 'gHead'} />

    case 'projectHead':
      return (
        <div className={`p ${gTop ? 'gTop' : item.gap} hd`}>
          {item.employer ? (
            <b>
              <span className='ul'>{item.employer}</span>
              {': '}
              {renderInlineBold(item.title)}
            </b>
          ) : (
            <div>{renderInlineBold(item.title)}</div>
          )}
          <span className='date'>{item.period}</span>
        </div>
      )

    case 'details':
      return (
        <div className={`p ind1${gTop ? ' gTop' : ''}`}>
          {item.lines.map((line, index) => (
            <div className='i1' key={index}>
              {renderInlineBold(line)}
            </div>
          ))}
        </div>
      )

    case 'highlights':
      return (
        <div className={`p ind2${gTop ? ' gTop' : ''}`}>
          {item.lines.map((line, index) => (
            <div className='i2' key={index}>
              {renderInlineBold(line)}
            </div>
          ))}
        </div>
      )

    case 'demo':
      return (
        <div className={`p ind1${gTop ? ' gTop' : ''}`}>
          <div className='i1'>
            <b>Demo:</b>{' '}
            {joinNodes(
              item.links.map(link => (
                <a className='lnk' key={link.href} href={link.href}>
                  {link.label}
                </a>
              )),
              ' | '
            )}
          </div>
        </div>
      )
  }
}

export default async function CVPage() {
  const resume = deriveResume({ resume: await loadPublicResume() })
  const sheets = planResumeSheets(resume)

  return (
    <main className={`cv ${arimo.variable}`}>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {/* ================================ PAGE 1 ================================ */}
      <section className='sheet' aria-label='Curriculum vitae, page 1 of 2'>
        <div className='mast'>
          <div
            style={{
              left: u(0.37),
              top: 0,
              width: u(181),
              height: u(181),
              border: `${u(4)} solid #000000`,
              borderRadius: '50%',
              overflow: 'hidden',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resume.photo}
              alt={resume.name}
              style={{ position: 'absolute', left: u(0), top: u(-0.05), width: u(202), height: u(202), objectFit: 'cover' }}
            />
          </div>

          <div className='name' style={{ left: u(233), top: u(21.95) }}>
            {resume.name}
          </div>
          <div className='role' style={{ left: u(233), top: u(68.95) }}>
            {resume.role}
          </div>
          <div className='rule' style={{ left: u(233), top: u(115.45), width: u(560) }} />

          <ContactRow contact={resume.contact} />
        </div>

        <SectionRule heading={resume.summary.heading} gap='gFirst' />
        <TextBlock block={resume.summary} justify />

        <SectionRule heading={resume.education.heading} gap='gHead' />
        <TextBlock block={resume.education} />

        {resume.skillBlocks.map((block, index) => (
          <Fragment key={block.heading || index}>
            <SectionRule heading={block.heading} gap={index === 0 ? 'gHead' : 'gHeadS'} />
            <SkillRows block={block} />
          </Fragment>
        ))}

        <SectionRule heading={resume.certifications.heading} gap='gHeadS' />
        <CertificationBody block={resume.certifications} />

        {sheets.first.map((item, index) => (
          <PrintItem key={index} item={item} gTop={false} />
        ))}
      </section>

      {/* ================================ PAGE 2 ================================ */}
      <section className='sheet' aria-label='Curriculum vitae, page 2 of 2'>
        {sheets.second.map((item, index) => (
          <PrintItem key={index} item={item} gTop={index === 0} />
        ))}
      </section>

      {/* Prints this page rather than serving a checked-in file, so the download can
          never fall behind an edit. */}
      <CvPrintButton />
    </main>
  )
}
