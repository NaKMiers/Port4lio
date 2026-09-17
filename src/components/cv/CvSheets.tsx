'use client'

import type { ReactNode } from 'react'

import { CV_SHEET_CSS, u } from '@/components/cv/cv-sheet-css'
import { renderInlineBold } from '@/lib/resume-inline'
import { CV_FALLBACK_PHOTO } from '@/lib/resume-seed'
import type { ResumePrintItem } from '@/lib/resume-view-model'
import { flattenResume, planResumeSheets } from '@/lib/resume-view-model'
import type {
  Resume,
  ResumeCertificationGroup,
  ResumeContact,
  ResumeSkillRow,
} from '@/types/profile'

/**
 * The 2 x A4 CV sheets, typographically identical to the original `Globee Trainee.pdf`.
 *
 * Rendered in two places: the public `/cv` route, and the settings editor's live preview
 * against unsaved state. That is why this is a client component that takes a `Resume`
 * outright and never reaches for `loadPublicResume` - the editor has no database round
 * trip to make, it already holds the resume in React state.
 *
 * Sheets are `height: 297mm; overflow: hidden`, so content that grows past the page is
 * CLIPPED, not reflowed. `CvTabPreview` measures for that and says so; nothing on the
 * public route does.
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
 * 34u between projects. The `g*` classes carry those gaps with each block's half-leading
 * already subtracted - see `cv-sheet-css.ts`.
 */

/**
 * Hand-measured gaps around the vector pipes in the masthead, in source units.
 *
 * Each value is tuned to the glyph advances of the specific strings on either side, so
 * CHANGING THE CONTACT COPY REQUIRES RE-MEASURING THESE. An overflow check cannot catch a
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

/**
 * Horizontal geometry of the name/role/rule/contact block, in source units.
 *
 * With the photo showing, that block starts to its right at 233u and its rule reaches to
 * 793u - the sheet's content edge (893u sheet minus the 50u margin on each side). Hiding
 * the photo does not shrink the masthead - `.mast` is a fixed height matching the photo's
 * own, sized independently of whether one prints - so the only thing to adjust is this
 * block reclaiming the width the photo used to occupy, by starting at the same left edge
 * as everything else on the sheet (0) instead of past the photo.
 */
const MASTHEAD_CONTENT_RIGHT = 793
const MASTHEAD_TEXT_LEFT_WITH_PHOTO = 233
const MASTHEAD_TEXT_LEFT_NO_PHOTO = 0

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

function ContactRow({ contact, left }: { contact: ResumeContact; left: number }) {
  const identity = [contact.email, contact.phone, contact.location].filter(Boolean)

  return (
    <div className='contact' style={{ left: u(left), top: u(138.95) }}>
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

function TextBlock({
  lines,
  justify,
  gTop,
}: {
  lines: string[]
  justify: boolean
  gTop: boolean
}) {
  return (
    <div className={`p ${gTop ? 'gTop' : 'gBody'}${justify ? ' jt' : ''}`}>
      {lines.map((line, index) => (
        <div key={index}>{renderInlineBold(line)}</div>
      ))}
    </div>
  )
}

function SkillRows({ rows, gTop }: { rows: ResumeSkillRow[]; gTop: boolean }) {
  return (
    <div className={`sk ${gTop ? 'gTop' : 'gSkill'}`}>
      {rows.map((row, index) => (
        <div key={index}>
          {row.items.map(item => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

function CertificationBody({
  groups,
  gTop,
}: {
  groups: ResumeCertificationGroup[]
  gTop: boolean
}) {
  return (
    <div className={`p ${gTop ? 'gTop' : 'gBody'}`}>
      {groups.map((group, index) => (
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

/** The fixed page header: photo, name, role, rule, contact rows. Always sheet 1, always first. */
function Masthead({ resume }: { resume: Resume }) {
  const textLeft = resume.hidePhoto ? MASTHEAD_TEXT_LEFT_NO_PHOTO : MASTHEAD_TEXT_LEFT_WITH_PHOTO

  return (
    <div className='mast'>
      {resume.hidePhoto ? null : (
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
            src={resume.photo || CV_FALLBACK_PHOTO}
            alt={resume.name}
            style={{
              position: 'absolute',
              left: u(0),
              top: u(-0.05),
              width: u(202),
              height: u(202),
              objectFit: 'cover',
            }}
          />
        </div>
      )}

      <div className='name' style={{ left: u(textLeft), top: u(21.95) }}>
        {resume.name}
      </div>
      <div className='role' style={{ left: u(textLeft), top: u(68.95) }}>
        {resume.role}
      </div>
      <div
        className='rule'
        style={{ left: u(textLeft), top: u(115.45), width: u(MASTHEAD_CONTENT_RIGHT - textLeft) }}
      />

      <ContactRow contact={resume.contact} left={textLeft} />
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
      return <SectionRule heading={item.text} gap={gTop ? 'gTop' : item.gap} />

    case 'text':
      return <TextBlock lines={item.lines} justify={item.justify} gTop={gTop} />

    case 'skillRows':
      return <SkillRows rows={item.rows} gTop={gTop} />

    case 'certifications':
      return <CertificationBody groups={item.groups} gTop={gTop} />

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

export default function CvSheets({ resume }: { resume: Resume }) {
  const sheets = planResumeSheets(resume)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CV_SHEET_CSS }} />

      {/* ================================ PAGE 1 ================================ */}
      <section className='sheet' aria-label='Curriculum vitae, page 1 of 2'>
        <Masthead resume={resume} />

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
    </>
  )
}

/**
 * Every printed block in one sheet of unbounded height, for measuring only.
 *
 * The page break is a manual coordinate into a fixed 297mm page, so the only way to know
 * where sheet 1 actually has to stop is to lay the whole stream out at true A4 width and
 * read the geometry back. Same component, same CSS, same order as the real sheets, with
 * the height cap and the clipping lifted - so `fitResumePageBreak` can find the last block
 * boundary that still fits.
 *
 * Never shown to anyone: callers park it offscreen and unmount it once measured.
 */
export function CvFlowSheet({ resume }: { resume: Resume }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CV_SHEET_CSS }} />

      {/* Only the height cap is lifted. `overflow: hidden` stays: it is what makes the sheet
          a block formatting context, and without it the masthead's top margin collapses out
          through the top edge and every block below measures ~41px too high. With an auto
          height it clips nothing. */}
      <section className='sheet' style={{ height: 'auto' }}>
        <Masthead resume={resume} />

        {flattenResume(resume).map((item, index) => (
          <PrintItem key={index} item={item} gTop={false} />
        ))}
      </section>
    </>
  )
}
