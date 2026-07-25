import type { Metadata } from 'next'
import { Arimo } from 'next/font/google'

/**
 * Static 2 x A4 CV, typographically identical to the original `Globee Trainee.pdf`.
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

export const metadata: Metadata = {
  title: 'Anh Khoa Nguyen — CV',
  description: 'Full Stack Developer — curriculum vitae of Anh Khoa Nguyen.',
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

/* ---- floating download action (screen only) -------------------------------- */
.dl {
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

export default function CVPage() {
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
              src='/cv/avatar.jpg'
              alt='Anh Khoa Nguyen'
              style={{ position: 'absolute', left: u(0), top: u(-0.05), width: u(202), height: u(202), objectFit: 'cover' }}
            />
          </div>

          <div className='name' style={{ left: u(233), top: u(21.95) }}>
            ANH KHOA NGUYEN
          </div>
          <div className='role' style={{ left: u(233), top: u(68.95) }}>
            FULL STACK DEVELOPER
          </div>
          <div className='rule' style={{ left: u(233), top: u(115.45), width: u(560) }} />

          <div className='contact' style={{ left: u(233), top: u(138.95) }}>
            <div>
              anhkhoa14904@gmail.com
              <span className='bar' style={{ marginLeft: u(12.58), marginRight: u(13.68) }} />
              0899 320 427
              <span className='bar' style={{ marginLeft: u(11.8), marginRight: u(14.16) }} />
              Tan Binh, Ho Chi Minh City
            </div>
            <div>
              {'Portfolio: '}
              <a className='ul' href='https://anhkhoa.info/'>
                <b>anhkhoa.info</b>
              </a>
              <span className='bar' style={{ marginLeft: u(2.8), marginRight: u(3.66) }} />
              {'Github: '}
              <a className='ul' href='https://github.com/NaKMiers'>
                <b>Nguyen Anh Khoa</b>
              </a>
              <span className='bar' style={{ marginLeft: u(3.08), marginRight: u(4.68) }} />
              {'LinkedIn: '}
              <a className='ul' href='https://www.linkedin.com/in/anh-khoa-nguyen-9539381a9'>
                <b>Anh Khoa Nguyen</b>
              </a>
            </div>
          </div>
        </div>

        {/* --- Summary --- */}
        <div className='sec gFirst'>
          SUMMARY
          <span />
        </div>
        <div className='p gBody jt'>
          <div>
            · Full Stack Developer · <b>1</b> year professional experience · <b>6k+</b> hours coding · <b>40+</b> projects
          </div>
          <div>
            · Passionate about software since <b>14</b> · Strong foundation with TypeScript, React.js, Next.js, Expo
          </div>
          <div>
            · <b>AI-first engineer</b> · Claude Code, agent skills and MCP are part of how I design, build and ship
          </div>
          <div>
            · Built, launched, and own an E-Commerce platform (<b>12k+</b> orders, <b>3.5k+</b> customers) and a budgeting app (<b>400+</b>{' '}users, App Store &amp; Play Store) - independently
          </div>
          <div>· I build for performance, reliability, and long-term scale - and I ship.</div>
        </div>

        {/* --- Education --- */}
        <div className='sec gHead'>
          EDUCATION
          <span />
        </div>
        <div className='p gBody'>
          <div>
            <b>Ho Chi Minh City University of Foreign Languages and Information Technology (HUFLIT)</b>
          </div>
          <div>Bachelor of Software Engineering</div>
        </div>

        {/* --- Technical skills --- */}
        <div className='sec gHead'>
          TECHNICAL SKILLS
          <span />
        </div>
        <div className='sk gSkill'>
          <div>
            <span>TypeScript</span>
            <span>NextJS</span>
            <span>ReactJS</span>
            <span>NodeJS</span>
            <span>Expo</span>
            <span>React Native</span>
            <span>PostgreSQL</span>
            <span>MongoDB</span>
            <span>AWS</span>
          </div>
          <div>
            <span>WebSocket</span>
            <span>Socket.IO</span>
            <span>Redis</span>
            <span>Bull Queue</span>
            <span>Prisma</span>
            <span>Docker</span>
            <span>Vercel</span>
            <span>REST</span>
            <span>GraphQL</span>
          </div>
        </div>

        {/* --- AI engineering --- */}
        <div className='sec gHeadS'>
          AI ENGINEERING
          <span />
        </div>
        <div className='sk gSkill'>
          <div>
            <span>Claude Code</span>
            <span>Agent Skills</span>
            <span>MCP</span>
            <span>Claude API</span>
            <span>OpenAI API</span>
            <span>Cursor</span>
            <span>Gstacks</span>
          </div>
          <div>
            <span>Prompt Engineering</span>
            <span>Agentic Workflows</span>
            <span>LLM Integration</span>
            <span>OCR Pipelines</span>
            <span>AI Code Review</span>
          </div>
        </div>

        {/* --- Soft skills --- */}
        <div className='sec gHeadS'>
          SOFT SKILLS
          <span />
        </div>
        <div className='sk gSkill'>
          <div>
            <span>Agile Scrum</span>
            <span>English Communication (TOEIC 780)</span>
            <span>Time Management</span>
            <span>Product ownership</span>
            <span>AI-first mindset</span>
          </div>
        </div>

        {/* --- Certifications --- */}
        <div className='sec gHeadS'>
          CERTIFICATIONS
          <span />
        </div>
        <div className='p gBody'>
          <div>
            <b>Anthropic, 2026: </b>
            <a className='ul' href='https://verify.skilljar.com/c/8o6g5ysos5w7'>
              Claude 101
            </a>
            {' · '}
            <a className='ul' href='https://verify.skilljar.com/c/omvytt6pbs7z'>
              Building with the Claude API
            </a>
            {' · '}
            <a className='ul' href='https://verify.skilljar.com/c/v47sjumd9nas'>
              Claude Code in Action
            </a>
            {' · '}
            <a className='ul' href='https://verify.skilljar.com/c/dayt6wxu4wpb'>
              Introduction to Agent Skills
            </a>
            {' · '}
            <a className='ul' href='https://verify.skilljar.com/c/ewnqdgqhaqik'>
              Introduction to Model Context Protocol
            </a>
          </div>
        </div>

        {/* --- Personal projects --- */}
        <div className='sec gHead'>
          PERSONAL PROJECTS
          <span />
        </div>

        <div className='p gBody hd'>
          <div>
            <b>Deewas: Budgeting App with AI </b>(Android, iOS)
          </div>
          <span className='date'>02/2025 - current</span>
        </div>
        <div className='p ind1'>
          <div className='i1'>
            <b>Position: Full Stack Developer (Owner)</b>
          </div>
          <div className='i1'>
            <b>Achievements:</b> Launched on Play Store, App Store and Web - <b>400+</b> real users, revenue from ads and subscriptions.
          </div>
          <div className='i1'>
            <b>Description: </b>A smart finance application that helps users track spending, income, savings and gain insights through AI-powered analysis.
          </div>
          <div className='i1'>
            <b>Technologies: </b>TypeScript, Expo, Next.js, Realm, MongoDB, OpenAI API, OCR, GCP, Vercel
          </div>
          <div className='i1'>
            <b>Key Responsibilities &amp; Highlights</b>
          </div>
        </div>
        <div className='p ind2'>
          <div className='i2'>Sole engineer - designed and built Android, iOS, and web from scratch</div>
          <div className='i2'>Architected offline-first infrastructure (Realm) with seamless cloud sync on login</div>
        </div>
      </section>

      {/* ================================ PAGE 2 ================================ */}
      <section className='sheet' aria-label='Curriculum vitae, page 2 of 2'>
        <div className='p ind2 gTop'>
          <div className='i2'>Integrated an AI assistant with a customizable personality for smart financial insights</div>
          <div className='i2'>Built an OCR pipeline to scan and extract data from receipts</div>
          <div className='i2'>
            Implemented <b>12+</b> features - Budgets, Saving Goals, Wallets, Categories, Calendar, Search, and more
          </div>
          <div className='i2'>Developed a Premium tier with subscription &amp; ad monetization</div>
        </div>
        <div className='p ind1'>
          <div className='i1'>
            <b>Demo:</b>{' '}
            <a className='lnk' href='https://apps.apple.com/us/app/deewas-smart-ai-money-planner/id6745058784'>
              App Store
            </a>
            {' | '}
            <a className='lnk' href='https://play.google.com/store/apps/details?id=com.nakmiers.deewas'>
              Play Store
            </a>
            {' | '}
            <a className='lnk' href='https://deewas.com/'>
              deewas.com
            </a>
          </div>
        </div>

        <div className='p gProj hd'>
          <b>Anpha Shop: E-commerce Website for Account Rental Services</b>
          <span className='date'>08/2023 - current</span>
        </div>
        <div className='p ind1'>
          <div className='i1'>
            <b>Position: Full Stack Developer (Owner)</b>
          </div>
          <div className='i1'>
            <b>Achievements: 3.5k+</b> real users, <b>12k+</b> completed orders, and strong SEO rankings.
          </div>
          <div className='i1'>
            <b>Description: </b>A full-featured e-commerce platform for account rental services, featuring a custom admin panel and built-in analytics dashboard.
          </div>
          <div className='i1'>
            <b>Technologies: </b>ReactJS, NextJS, NodeJS, TypeScript, MongoDB, AWS, GCP, Vercel
          </div>
          <div className='i1'>
            <b>Key Features &amp; Responsibilities:</b>
          </div>
        </div>
        <div className='p ind2'>
          <div className='i2'>Built entirely solo - every line of code, from frontend to backend, from scratch</div>
          <div className='i2'>Developed core features such as order management, payment processing, and customer management.</div>
          <div className='i2'>
            Scaled the system to support <b>3,500+</b> real customers and over <b>12,000+</b> completed orders.
          </div>
        </div>
        <div className='p ind1'>
          <div className='i1'>
            <b>Demo: </b>
            <a className='lnk' href='https://anpha.shop/'>
              anpha.shop
            </a>
          </div>
        </div>

        {/* --- Work projects --- */}
        <div className='sec gHead'>
          WORK PROJECTS
          <span />
        </div>

        <div className='p gBody hd'>
          <b>
            <span className='ul'>Rikkeisoft</span>: Enterprise WMS - AngularJS to Next.js Migration
          </b>
          <span className='date'>4 months</span>
        </div>
        <div className='p ind1'>
          <div className='i1'>
            <b>Position: Full Stack Developer</b>
          </div>
          <div className='i1'>
            <b>Description: </b>Modernization of a Japanese enterprise warehouse management system - replacing a legacy AngularJS frontend with a Next.js App Router app over a Laravel API.
          </div>
          <div className='i1'>
            <b>Technologies: </b>Next.js, TypeScript, Turborepo, Zustand, TanStack Table, ShadCN UI, NextAuth, Zod, Orval, Vitest, Laravel, MySQL, Docker
          </div>
          <div className='i1'>
            <b>Contributions</b>
          </div>
        </div>
        <div className='p ind2'>
          <div className='i2'>Migrated inbound, outbound, picking and inspection screens from AngularJS to the App Router</div>
          <div className='i2'>Built shared screen-driven UI, hooks and types in a Turborepo monorepo used by the whole team</div>
          <div className='i2'>Implemented JWT authentication with NextAuth over a proxy layer to the Laravel API</div>
          <div className='i2'>Delivered bilingual (JA/EN) screens with next-intl and Zod-validated react-hook-form flows</div>
          <div className='i2'>Drove migration with Claude Code and repo-scoped agent skills to hold team conventions</div>
          <div className='i2'>Wrote Vitest unit tests and cleared automated code-review findings before every merge</div>
        </div>

        <div className='p gProj hd'>
          <b>
            <span className='ul'>Rikkeisoft</span>: AI Medical Assistant
          </b>
          <span className='date'>5 months</span>
        </div>
        <div className='p ind1'>
          <div className='i1'>
            <b>Position: Full Stack Developer</b>
          </div>
          <div className='i1'>
            <b>Description: </b>An AI-powered medical platform integrating LLM capabilities into healthcare workflows.
          </div>
          <div className='i1'>
            <b>Technologies: </b>Next.js, TypeScript, AWS, DynamoDB, S3, OpenAI, API, SSO, TailwindCSS, ShadCNUI
          </div>
          <div className='i1'>
            <b>Contributions</b>
          </div>
        </div>
        <div className='p ind2'>
          <div className='i2'>Served as main developer on the team - led core feature development and supported other members</div>
          <div className='i2'>Built and integrated LLM-powered features via OpenAI API for medical assistance workflows</div>
          <div className='i2'>Architected frontend with Next.js, ShadCN UI, and Tailwind CSS for a clean, scalable UI</div>
          <div className='i2'>Wrote unit tests and performed manual testing to ensure reliability and accuracy</div>
        </div>

        <div className='p gProj hd'>
          <b>
            <span className='ul'>Rikkeisoft</span>: Enterprise Chat Platform
          </b>
          <span className='date'>3 months</span>
        </div>
        <div className='p ind1'>
          <div className='i1'>
            <b>Position: Full Stack Developer</b>
          </div>
          <div className='i1'>
            <b>Description: </b>An enterprise workspace for customer communication over Zalo and Chat Plus, with real-time support.
          </div>
          <div className='i1'>
            <b>Technologies: </b>Node.js, ExpressJS, TypeScript, PostgreSQL, MongoDB, Redis, Bull Queue, Socket.IO, Docker
          </div>
          <div className='i1'>
            <b>Contributions</b>
          </div>
        </div>
        <div className='p ind2'>
          <div className='i2'>Integrated Zalo APIs - built webhook handlers and outbound messaging flows for customers</div>
          <div className='i2'>Engineered real-time chat infrastructure using WebSocket &amp; Socket.IO</div>
          <div className='i2'>Improved backend performance through logic optimization and algorithm refinement</div>
        </div>
      </section>

      {/* Plain anchor, no client JS — the file is this exact page rendered to A4. */}
      <a className='dl' href='/cv/anh-khoa-nguyen-cv.pdf' download='Anh-Khoa-Nguyen-CV.pdf'>
        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
          <path d='M12 3v12' />
          <path d='m7 10 5 5 5-5' />
          <path d='M4 20h16' />
        </svg>
        Download PDF
      </a>
    </main>
  )
}
