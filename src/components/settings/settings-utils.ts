import type {
  Certificate,
  EducationItem,
  ExperienceItem,
  Profile,
  ProjectItem,
  ProjectPart,
  ServiceItem,
  SocialLink,
  SkillGroup,
  SkillItem,
} from '@/types/profile'
import { makeEmptyProfile, normalizeProfile } from '@/lib/profile'
import { MAX_UPLOAD_BYTES, formatMaxUploadMb } from '@/lib/upload-limits'

export const MAX_UPLOAD_MB_LABEL = formatMaxUploadMb()

export const labelCls =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted'
export const inputCls =
  'block w-full rounded-[1.05rem] border border-pp-line bg-white/78 px-4 py-3 text-sm text-pp-text shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition placeholder:text-pp-muted/75 focus:border-pp-blue/55 focus:bg-white focus:ring-4 focus:ring-pp-blue/10'
export const textareaCls =
  'block w-full min-h-[88px] rounded-[1.1rem] border border-pp-line bg-white/78 px-4 py-3 text-sm text-pp-text shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition placeholder:text-pp-muted/75 focus:border-pp-blue/55 focus:bg-white focus:ring-4 focus:ring-pp-blue/10'
export const secondaryBtnCls =
  'inline-flex items-center justify-center rounded-full border border-pp-line bg-white/82 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-text shadow-[0_12px_30px_rgba(46,35,28,0.06)] transition hover:-translate-y-0.5 hover:bg-white'
export const ghostBtnCls =
  'inline-flex items-center justify-center rounded-full border border-transparent px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted transition hover:border-pp-line hover:bg-white/78 hover:text-pp-text'
export const primaryBtnCls =
  'inline-flex items-center justify-center rounded-full bg-pp-text px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(17,17,17,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_40px_rgba(17,17,17,0.22)] disabled:cursor-not-allowed disabled:opacity-60'
export const itemCardCls =
  'rounded-[1.4rem] border border-pp-line bg-white/72 p-4 shadow-[0_18px_36px_rgba(46,35,28,0.06)] backdrop-blur-md'
export const nestedItemCardCls =
  'rounded-[1.2rem] border border-pp-line bg-[rgba(255,255,255,0.58)] p-4 shadow-[0_14px_26px_rgba(46,35,28,0.05)] backdrop-blur-sm'
export const iconPreviewCls =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,240,233,0.92))] text-pp-text shadow-[0_10px_20px_rgba(46,35,28,0.06)]'
export const helpTextCls = 'text-xs leading-relaxed text-pp-muted'
export const emptyStateCls =
  'rounded-[1rem] border border-dashed border-pp-line bg-white/42 px-4 py-3 text-xs font-medium text-pp-muted'
export const uploadInputCls =
  `${inputCls} file:mr-3 file:rounded-full file:border file:border-pp-line file:bg-[rgba(255,255,255,0.94)] file:px-3.5 file:py-2 file:text-[11px] file:font-semibold file:uppercase file:tracking-[0.14em] file:text-pp-text hover:file:bg-white`
export const inlineLinkCls =
  'text-xs font-semibold text-pp-blue underline decoration-pp-blue/45 underline-offset-[0.2em] hover:decoration-pp-blue'

export async function uploadAssetToCloudinary(
  file: File,
  kind: 'avatar' | 'background' | 'cv' | 'cv-photo' | 'project',
  projectIndex?: number
): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File must be ${MAX_UPLOAD_MB_LABEL} MB or smaller`)
  }
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  if (kind === 'project' && projectIndex !== undefined) {
    fd.append('projectIndex', String(projectIndex))
  }
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  const data = (await res.json()) as { url?: string; error?: string }
  if (!res.ok) throw new Error(data?.error || 'Upload failed')
  if (!data.url) throw new Error('Upload returned no URL')
  return data.url
}

export function makeMockProfile(): Profile {
  return {
    cv: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    fullName: 'Alex Johnson',
    username: 'Alex Developer',
    jobTitle: ['Full-stack engineer'],
    description: 'I build fast, accessible web apps with Next.js and thoughtful UX.',
    avatar: '/file.svg',
    backgroundImage: '/vercel.svg',
    socials: [
      { name: 'AlexDev', icon: 'github', link: 'https://github.com/example' },
      { name: 'Alex', icon: 'linkedin', link: 'https://linkedin.com/in/example' },
    ],
    profileHeading: 'Ship products people love',
    profileSubHeading: 'Design systems, APIs, and polished interfaces.',
    stats: [
      { label: 'Years experience', value: 6 },
      { label: 'Projects shipped', value: 24 },
    ],
    aboutMe:
      'Former designer turned engineer. I care about performance, a11y, and clear copy. Based in UTC+7.',
    skills: [
      {
        groupName: 'Frontend',
        items: [
          { icon: 'react', name: 'React' },
          { icon: 'next', name: 'Next.js' },
        ],
      },
      {
        groupName: 'Backend',
        items: [
          { icon: 'node', name: 'Node.js' },
          { icon: 'mongo', name: 'MongoDB' },
        ],
      },
    ],
    experience: [
      { companyName: 'Acme Labs', position: 'Senior engineer', start: '2021-03-01', end: '2025-01-15' },
      { companyName: 'Beta Studio', position: 'Full-stack developer', start: '2019-06-01', end: '2021-02-28' },
    ],
    education: [
      { schoolName: 'State University', major: 'Computer Science', start: '2015-09-01', end: '2019-05-01' },
    ],
    certificates: [{ name: 'AWS Cloud Practitioner', link: 'https://example.com/cert/aws' }],
    serviceHeading: 'What I can help with',
    serviceSubHeading: 'From idea to production',
    briefServices: ['Web apps', 'API design', 'Performance audits', 'Mentoring'],
    services: [
      { icon: 'layout', title: 'Product builds', description: 'End-to-end implementation with CI, monitoring, and docs.' },
      { icon: 'zap', title: 'Performance', description: 'Core Web Vitals, caching, and lean bundles.' },
    ],
    workHeading: 'Selected work',
    workSubHeading: 'Recent case studies',
    projects: [
      {
        title: 'Analytics Dashboard',
        parts: [
          {
            image: '/window.svg',
            description: 'SaaS dashboard with real-time analytics and role-based access.',
            link: 'https://example.com/demo',
          },
          {
            image: '/file.svg',
            description: 'Repository and technical notes.',
            link: 'https://github.com/example/app',
          },
        ],
      },
      {
        title: 'Marketing Platform',
        parts: [
          {
            image: '/vercel.svg',
            description: 'Marketing site with CMS-driven content and A/B hooks.',
            link: 'https://example.com/case-study',
          },
        ],
      },
    ],
  }
}

