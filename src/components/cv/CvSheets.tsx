'use client'

import { Fragment } from 'react'
import type { ReactNode } from 'react'

import { CV_SHEET_CSS, u } from '@/components/cv/cv-sheet-css'
import { renderInlineBold } from '@/lib/resume-inline'
import { CV_FALLBACK_PHOTO } from '@/lib/resume-seed'
import type { ResumePrintItem } from '@/lib/resume-view-model'
import { planResumeSheets } from '@/lib/resume-view-model'
import type {
  Resume,
  ResumeCertificationBlock,
  ResumeContact,
  ResumeSkillBlock,
  ResumeTextBlock,
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

export default function CvSheets({ resume }: { resume: Resume }) {
  const sheets = planResumeSheets(resume)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CV_SHEET_CSS }} />

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
    </>
  )
}
