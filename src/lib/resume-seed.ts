import { DEFAULT_RESUME_SECTION_ORDER } from '@/lib/resume-sections'
import type { Resume } from '@/types/profile'

/**
 * Printed when neither a CV-specific photo nor a portfolio avatar is set - the last rung
 * of the chain in `deriveResume`, applied at the `/cv` masthead so an unset photo still
 * reads as "inherit the avatar" everywhere else.
 */
export const CV_FALLBACK_PHOTO = '/cv/avatar.jpg'

/**
 * The CV content as it stood when `/cv` became data-driven, transcribed field for field
 * from the previously hardcoded JSX (`<b>` -> `**`, `&amp;` -> `&`).
 *
 * `deriveResume` falls back to this when the profile document has no `resume` block, so
 * the refactor ships without touching Mongo and stays revertable. Saving once in
 * `/settings` writes it to the database; this file can then be deleted.
 *
 * Being a typed literal, `tsc --noEmit` proves the transcription is structurally complete.
 */
export const RESUME_SEED: Resume = {
  name: 'ANH KHOA NGUYEN',
  role: 'FULL STACK DEVELOPER',
  // Empty on purpose: an unwritten CV block should inherit the portfolio avatar rather
  // than pin the bundled file, and saving the seed once must not turn that inheritance
  // into an explicit override.
  photo: '',

  sectionOrder: [...DEFAULT_RESUME_SECTION_ORDER],

  contact: {
    email: 'anhkhoa14904@gmail.com',
    phone: '0899 320 427',
    location: 'Tan Binh, Ho Chi Minh City',
    links: [
      { label: 'Portfolio', text: 'anhkhoa.info', href: 'https://anhkhoa.info/' },
      { label: 'Github', text: 'Nguyen Anh Khoa', href: 'https://github.com/NaKMiers' },
      {
        label: 'LinkedIn',
        text: 'Anh Khoa Nguyen',
        href: 'https://www.linkedin.com/in/anh-khoa-nguyen-9539381a9',
      },
    ],
  },

  summary: {
    heading: 'SUMMARY',
    lines: [
      '· Full Stack Developer · **1** year professional experience · **6k+** hours coding · **40+** projects',
      '· Passionate about software since **14** · Strong foundation with TypeScript, React.js, Next.js, Expo',
      '· **AI-first engineer** · Claude Code, agent skills and MCP are part of how I design, build and ship',
      '· Built, launched, and own an E-Commerce platform (**12k+** orders, **3.5k+** customers) and a budgeting app (**400+** users, App Store & Play Store) - independently',
      '· I build for performance, reliability, and long-term scale - and I ship.',
    ],
  },

  education: {
    heading: 'EDUCATION',
    lines: [
      '**Ho Chi Minh City University of Foreign Languages and Information Technology (HUFLIT)**',
      'Bachelor of Software Engineering',
    ],
  },

  skillBlocks: [
    {
      heading: 'TECHNICAL SKILLS',
      rows: [
        {
          items: [
            'TypeScript',
            'NextJS',
            'ReactJS',
            'NodeJS',
            'Expo',
            'React Native',
            'PostgreSQL',
            'MongoDB',
            'AWS',
          ],
        },
        {
          items: [
            'WebSocket',
            'Socket.IO',
            'Redis',
            'Bull Queue',
            'Prisma',
            'Docker',
            'Vercel',
            'REST',
            'GraphQL',
          ],
        },
      ],
    },
    {
      heading: 'AI ENGINEERING',
      rows: [
        {
          items: [
            'Claude Code',
            'Agent Skills',
            'MCP',
            'Claude API',
            'OpenAI API',
            'Cursor',
            'Gstacks',
          ],
        },
        {
          items: [
            'Prompt Engineering',
            'Agentic Workflows',
            'LLM Integration',
            'OCR Pipelines',
            'AI Code Review',
          ],
        },
      ],
    },
    {
      heading: 'SOFT SKILLS',
      rows: [
        {
          items: [
            'Agile Scrum',
            'English Communication (TOEIC 780)',
            'Time Management',
            'Product ownership',
            'AI-first mindset',
          ],
        },
      ],
    },
  ],

  certifications: {
    heading: 'CERTIFICATIONS',
    groups: [
      {
        issuer: 'Anthropic, 2026',
        items: [
          { name: 'Claude 101', link: 'https://verify.skilljar.com/c/8o6g5ysos5w7' },
          {
            name: 'Building with the Claude API',
            link: 'https://verify.skilljar.com/c/omvytt6pbs7z',
          },
          { name: 'Claude Code in Action', link: 'https://verify.skilljar.com/c/v47sjumd9nas' },
          {
            name: 'Introduction to Agent Skills',
            link: 'https://verify.skilljar.com/c/dayt6wxu4wpb',
          },
          {
            name: 'Introduction to Model Context Protocol',
            link: 'https://verify.skilljar.com/c/ewnqdgqhaqik',
          },
        ],
      },
    ],
  },

  projectSections: [
    {
      heading: 'PERSONAL PROJECTS',
      items: [
        {
          employer: '',
          title: '**Deewas: Budgeting App with AI **(Android, iOS)',
          period: '02/2025 - current',
          details: [
            '**Position: Full Stack Developer (Owner)**',
            '**Achievements:** Launched on Play Store, App Store and Web - **400+** real users, revenue from ads and subscriptions.',
            '**Description: **A smart finance application that helps users track spending, income, savings and gain insights through AI-powered analysis.',
            '**Technologies: **TypeScript, Expo, Next.js, Realm, MongoDB, OpenAI API, OCR, GCP, Vercel',
            '**Key Responsibilities & Highlights**',
          ],
          highlights: [
            'Sole engineer - designed and built Android, iOS, and web from scratch',
            'Architected offline-first infrastructure (Realm) with seamless cloud sync on login',
            'Integrated an AI assistant with a customizable personality for smart financial insights',
            'Built an OCR pipeline to scan and extract data from receipts',
            'Implemented **12+** features - Budgets, Saving Goals, Wallets, Categories, Calendar, Search, and more',
            'Developed a Premium tier with subscription & ad monetization',
          ],
          demoLinks: [
            {
              label: 'App Store',
              href: 'https://apps.apple.com/us/app/deewas-smart-ai-money-planner/id6745058784',
            },
            {
              label: 'Play Store',
              href: 'https://play.google.com/store/apps/details?id=com.nakmiers.deewas',
            },
            { label: 'deewas.com', href: 'https://deewas.com/' },
          ],
        },
        {
          employer: '',
          title: '**Anpha Shop: E-commerce Website for Account Rental Services**',
          period: '08/2023 - current',
          details: [
            '**Position: Full Stack Developer (Owner)**',
            '**Achievements: 3.5k+** real users, **12k+** completed orders, and strong SEO rankings.',
            '**Description: **A full-featured e-commerce platform for account rental services, featuring a custom admin panel and built-in analytics dashboard.',
            '**Technologies: **ReactJS, NextJS, NodeJS, TypeScript, MongoDB, AWS, GCP, Vercel',
            '**Key Features & Responsibilities:**',
          ],
          highlights: [
            'Built entirely solo - every line of code, from frontend to backend, from scratch',
            'Developed core features such as order management, payment processing, and customer management.',
            'Scaled the system to support **3,500+** real customers and over **12,000+** completed orders.',
          ],
          demoLinks: [{ label: 'anpha.shop', href: 'https://anpha.shop/' }],
        },
      ],
    },
    {
      heading: 'WORK PROJECTS',
      items: [
        {
          employer: 'Rikkeisoft',
          title: 'Enterprise WMS - AngularJS to Next.js Migration',
          period: '4 months',
          details: [
            '**Position: Full Stack Developer**',
            '**Description: **Modernization of a Japanese enterprise warehouse management system - replacing a legacy AngularJS frontend with a Next.js App Router app over a Laravel API.',
            '**Technologies: **Next.js, TypeScript, Turborepo, Zustand, TanStack Table, ShadCN UI, NextAuth, Zod, Orval, Vitest, Laravel, MySQL, Docker',
            '**Contributions**',
          ],
          highlights: [
            'Migrated inbound, outbound, picking and inspection screens from AngularJS to the App Router',
            'Built shared screen-driven UI, hooks and types in a Turborepo monorepo used by the whole team',
            'Implemented JWT authentication with NextAuth over a proxy layer to the Laravel API',
            'Delivered bilingual (JA/EN) screens with next-intl and Zod-validated react-hook-form flows',
            'Drove migration with Claude Code and repo-scoped agent skills to hold team conventions',
            'Wrote Vitest unit tests and cleared automated code-review findings before every merge',
          ],
          demoLinks: [],
        },
        {
          employer: 'Rikkeisoft',
          title: 'AI Medical Assistant',
          period: '5 months',
          details: [
            '**Position: Full Stack Developer**',
            '**Description: **An AI-powered medical platform integrating LLM capabilities into healthcare workflows.',
            '**Technologies: **Next.js, TypeScript, AWS, DynamoDB, S3, OpenAI, API, SSO, TailwindCSS, ShadCNUI',
            '**Contributions**',
          ],
          highlights: [
            'Served as main developer on the team - led core feature development and supported other members',
            'Built and integrated LLM-powered features via OpenAI API for medical assistance workflows',
            'Architected frontend with Next.js, ShadCN UI, and Tailwind CSS for a clean, scalable UI',
            'Wrote unit tests and performed manual testing to ensure reliability and accuracy',
          ],
          demoLinks: [],
        },
        {
          employer: 'Rikkeisoft',
          title: 'Enterprise Chat Platform',
          period: '3 months',
          details: [
            '**Position: Full Stack Developer**',
            '**Description: **An enterprise workspace for customer communication over Zalo and Chat Plus, with real-time support.',
            '**Technologies: **Node.js, ExpressJS, TypeScript, PostgreSQL, MongoDB, Redis, Bull Queue, Socket.IO, Docker',
            '**Contributions**',
          ],
          highlights: [
            'Integrated Zalo APIs - built webhook handlers and outbound messaging flows for customers',
            'Engineered real-time chat infrastructure using WebSocket & Socket.IO',
            'Improved backend performance through logic optimization and algorithm refinement',
          ],
          demoLinks: [],
        },
      ],
    },
  ],

  // Sheet 1 ends two bullets into the Deewas highlight list - the source splits mid list.
  pageBreak: { sectionIndex: 0, projectIndex: 0, highlightsOnFirstSheet: 2 },
}
