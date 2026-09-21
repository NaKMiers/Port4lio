import type { CareerContent } from '@/lib/mbti/content/types'
import type { MbtiType } from '@/lib/mbti/types'

/**
 * Careers by type - English.
 *
 * Same substance as `careers.vi.ts`, written natively rather than translated. The role
 * lists differ slightly between locales on purpose: the Vietnamese file leans toward roles
 * that actually exist in that job market, and translating one list into the other would
 * make one of them subtly wrong about the reader's options.
 *
 * Tendencies, never prescriptions. A type does not determine a career, and the page says
 * so directly beneath this section.
 */
export const CAREERS_EN: Record<MbtiType, CareerContent> = {
  ENTJ: {
    workStyle:
      'You organise work around outcomes and dates, and a meeting that ends without anyone owning anything genuinely bothers you. You decide fast on incomplete information, because you treat standing still as a choice with a cost.',
    roles: [
      'Operations lead, head of department',
      'Executive and senior management',
      'Strategy or management consulting',
      'Founder / co-founder',
      'Product management',
      'Corporate law, legal counsel',
      'Investment analysis, business development',
    ],
    thrivesIn:
      'Real decision-making authority, measurable goals, and colleagues willing to push back to your face.',
    drainedBy:
      'Repetitive work you cannot redesign, three layers of approval for small calls, and meetings that reach no decision.',
  },
  INTJ: {
    workStyle:
      'You do your best work handed a hard problem and enough quiet to build a model of it. You would rather fix the root cause than the symptom, even when that takes longer than anyone wants.',
    roles: [
      'Software architect, systems engineer',
      'Data scientist, machine learning engineer',
      'Research, academia',
      'Financial analysis, risk management',
      'Product strategy, business analysis',
      'Process design, operations optimisation',
    ],
    thrivesIn:
      'Depth, few interruptions, and being judged on the quality of the answer rather than hours at a desk.',
    drainedBy:
      'A calendar full of meetings, having to sell an idea on feeling rather than reasoning, and places where politics outrank competence.',
  },
  ENTP: {
    workStyle:
      'You are strongest before anyone knows what to do: finding another angle, testing fast, dropping it faster. The later it gets - maintenance, squeezing out another percent - the harder you find it to stay in the chair.',
    roles: [
      'Founder, business development',
      'Solutions consulting, digital transformation',
      'Creative marketing, brand strategy',
      'R&D, new product development',
      'Litigation, contract negotiation',
      'Content, media, podcasting',
    ],
    thrivesIn:
      'New problems, colleagues who will argue, and permission to try something untested.',
    drainedBy:
      'Rigid process nobody may question, long maintenance work, and meetings whose conclusion was settled beforehand.',
  },
  INTP: {
    workStyle:
      'You want to understand a system to the bottom before touching it, and you routinely find the hole everyone else walked past. You work in bursts: several loose days, then one very deep one.',
    roles: [
      'Software engineering, backend development',
      'Scientific research, mathematics, statistics',
      'Security research, penetration testing',
      'Systems analysis, database design',
      'Technical writing',
      'Data analysis, quantitative research',
    ],
    thrivesIn:
      'Open-ended problems, few meetings, and a manager who measures output rather than presence.',
    drainedBy:
      'Constant tight deadlines, managing people, and work that demands more socialising than thinking.',
  },

  ENFJ: {
    workStyle:
      'You read the mood of a group and usually end up the one keeping everyone pointed the same way. You work through people: persuading, connecting, defusing friction before it becomes a problem.',
    roles: [
      'Teaching, lecturing, corporate training',
      'HR, organisational development',
      'Coaching, career counselling',
      'Community management, internal communications',
      'Public relations, partnerships',
      'Non-profit leadership, social programmes',
    ],
    thrivesIn:
      'Work whose effect on people you can see, and being trusted to lead rather than only execute.',
    drainedBy:
      'Places that look only at numbers, unresolved conflict left to fester, and having to make a decision that hurts someone without being allowed to explain it.',
  },
  INFJ: {
    workStyle:
      'You see where something is heading before you can explain why, and you are usually right. You need solitude to think, but almost everything you think about is aimed at other people.',
    roles: [
      'Psychotherapy, counselling',
      'Writing, editing',
      'UX research and design',
      'Social research, anthropology',
      'Education, curriculum design',
      'Social work, non-profits',
    ],
    thrivesIn:
      'Work with a clear point, quiet space to think, and depth with a few people rather than a wide network.',
    drainedBy:
      'Open offices with nowhere to retreat, quota-driven selling, and shallow work you cannot see serving anyone.',
  },
  ENFP: {
    workStyle:
      'You start extremely well: ideas, energy, and the ability to pull other people in. The hard part is the middle, once everything is decided and what remains is finishing it.',
    roles: [
      'Content creation, copywriting',
      'Marketing, brand communications',
      'Training, experience design',
      'Social entrepreneurship, fundraising',
      'Career counselling, recruitment',
      'Design, programme production',
    ],
    thrivesIn:
      'New projects, people around you, and enough freedom to change approach mid-way when you see a better one.',
    drainedBy:
      'Work that repeats daily, rules nobody can justify, and long stretches alone.',
  },
  INFP: {
    workStyle:
      'You produce most when you believe in what you are doing, and almost cannot force good work out of something that conflicts with your values. You are exacting about quality by your own standard, not the assessor’s.',
    roles: [
      'Writing, editing, content',
      'Translation, proofreading',
      'Graphic design, illustration',
      'Counselling, social work',
      'Education, especially special education',
      'Non-profits, community programmes',
    ],
    thrivesIn:
      'Work tied to something you actually care about, your own pace, and a manager who gives feedback privately.',
    drainedBy:
      'Fierce internal competition, defending a position you do not hold, and constant assessment on short-term metrics.',
  },

  ESTJ: {
    workStyle:
      'You turn a mess into a process that runs, and then keep it running. You say so when something is wrong, and you expect the same in return.',
    roles: [
      'Operations management, production management',
      'Project management, supply chain',
      'Financial controller, internal audit',
      'Banking, branch management',
      'Military, police, safety management',
      'Retail management, regional sales management',
    ],
    thrivesIn:
      'Clear ownership, measurable standards, and authority that matches what you are held responsible for.',
    drainedBy:
      'Vague goals, people who do not keep commitments, and open-ended idea sessions that never close.',
  },
  ISTJ: {
    workStyle:
      'You do it correctly, completely, and for as long as it needs doing. You hold detail other people drop, and you are usually the one who notices the number that does not reconcile.',
    roles: [
      'Audit, accounting',
      'Legal, compliance',
      'Systems administration, infrastructure operations',
      'Quality assurance and control',
      'Administration, records management',
      'Data analysis, financial reporting',
    ],
    thrivesIn:
      'Clear standards, stable expectations, and enough time to do it right the first time.',
    drainedBy:
      'Requirements that change mid-way, improvising without data, and places that shrug at small errors.',
  },
  ESFJ: {
    workStyle:
      'You notice who is struggling before they say anything, and you are often the glue keeping a team together. You work best knowing exactly who you are helping.',
    roles: [
      'HR, recruitment, employee experience',
      'Nursing, allied health',
      'Early years and primary teaching',
      'Customer service, service management',
      'Event management, office administration',
      'Retail, store management',
    ],
    thrivesIn:
      'A close team, clear process, and work where doing well means someone was actually helped.',
    drainedBy:
      'Cold or quietly hostile environments, long stretches working alone, and being assessed without any credit for the care work you do.',
  },
  ISFJ: {
    workStyle:
      'You keep things running by quietly handling what nobody assigned. You rarely claim credit, so your contribution is usually under-counted.',
    roles: [
      'Nursing, healthcare support',
      'Executive assistance, HR administration',
      'Teaching, teaching assistance',
      'Libraries, archives, records',
      'Accounting, document control',
      'Customer support, technical support',
    ],
    thrivesIn:
      'Stability, clear expectations, and someone who notices the work you did without being asked.',
    drainedBy:
      'Open conflict, sudden unannounced change, and roles that require competing for attention.',
  },

  ESTP: {
    workStyle:
      'You handle a real situation far better than a plan on paper. When something breaks, you are the fastest reaction in the room.',
    roles: [
      'Sales, direct sales',
      'Real estate, brokerage',
      'Founding, store management',
      'Emergency services, security, athletic coaching',
      'Commercial negotiation, procurement',
      'Event management, field production',
    ],
    thrivesIn:
      'Fast pace, results you can see immediately, and pay tied to actual performance rather than seniority.',
    drainedBy:
      'Desk work, long theoretical meetings, and five-year plans for something that may not exist next month.',
  },
  ISTP: {
    workStyle:
      'You learn by taking things apart. You say little, but when something breaks you find the cause while everyone else is still discussing it.',
    roles: [
      'Mechanical and electrical engineering',
      'Maintenance technician, machine operation',
      'Network and security engineering',
      'Aviation, aircraft engineering',
      'Automotive engineering, fabrication',
      'Forensic and technical investigation',
    ],
    thrivesIn:
      'Hands-on problems, good tools, and being left alone once you understand the job.',
    drainedBy:
      'Long meetings with no conclusion, heavy paperwork, and environments that require talking about feelings often.',
  },
  ESFP: {
    workStyle:
      'You work through energy and presence: customers remember you, and a shift is easier when you are on it. You are better at now than at long-range planning.',
    roles: [
      'Performance, presenting, hosting',
      'Travel, tourism, hotel management',
      'Restaurants, hospitality, service management',
      'Sales, customer experience',
      'Event management, activations',
      'Fashion, beauty, visual merchandising',
    ],
    thrivesIn:
      'People, pace, and results visible within the day rather than the quarter.',
    drainedBy:
      'Sitting alone with a spreadsheet, long projects with nothing to show yet, and heavily formal environments.',
  },
  ISFP: {
    workStyle:
      'You make things with a taste of your own and dislike being told to work to someone else’s template. You rarely argue, but you rarely change your mind about what looks right either.',
    roles: [
      'Graphic design, interior design',
      'Photography, video production',
      'Culinary arts, bartending',
      'Fashion, craft and making',
      'Physiotherapy, art therapy',
      'Horticulture, landscaping, animal care',
    ],
    thrivesIn:
      'Making something concrete, your own pace, and a manager who trusts your judgement of what is good.',
    drainedBy:
      'Aggressive competition, rigid process, and being criticised sharply in front of others.',
  },
}
