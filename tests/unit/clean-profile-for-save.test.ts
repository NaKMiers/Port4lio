import { describe, expect, it } from 'vitest'

import {
  cleanProfileForSave,
  pruneResumeForCv,
} from '@/components/settings/cleanProfileForSave'
import { makeEmptyProfile, makeEmptyResume } from '@/lib/profile'
import { RESUME_SEED } from '@/lib/resume-seed'

/**
 * The two save bodies after multi-CV (multi-cv-plan.md OV-8).
 *
 * ```
 *   Save profile  cleanProfileForSave(profile)  never carries `resume`, even though it spreads
 *                                               `...profile` and the loaded profile has one
 *   Save CV       pruneResumeForCv(draft)       always a Resume - an emptied CV saves empty
 * ```
 */

describe('cleanProfileForSave', () => {
  it('drops `resume` even when the editor profile carries the legacy block', () => {
    const body = cleanProfileForSave({
      ...makeEmptyProfile(),
      fullName: ' Ada ',
      resume: RESUME_SEED,
    })

    expect('resume' in body).toBe(false)
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('resume')
    expect(body.fullName).toBe('Ada')
  })
})

describe('pruneResumeForCv', () => {
  it('never returns undefined: an emptied CV is saved as an empty Resume', () => {
    const pruned = pruneResumeForCv({
      ...makeEmptyResume(),
      name: '   ',
      summary: { heading: '', lines: ['  ', ''] },
    })

    expect(pruned).toBeDefined()
    expect(pruned.name).toBe('')
    expect(pruned.summary.lines).toEqual([])
    expect(pruned.projectSections).toEqual([])
  })

  it('trims and drops empty entries the way Save profile always did', () => {
    const pruned = pruneResumeForCv({
      ...makeEmptyResume(),
      name: '  Ada  ',
      hidePhoto: true,
      contact: {
        email: ' a@example.com ',
        phone: '',
        location: '',
        links: [
          { label: '', text: '', href: '' },
          { label: 'Site', text: 'ada.dev', href: ' https://ada.dev ' },
        ],
      },
    })

    expect(pruned.name).toBe('Ada')
    expect(pruned.hidePhoto).toBe(true)
    expect(pruned.contact.email).toBe('a@example.com')
    expect(pruned.contact.links).toEqual([
      { label: 'Site', text: 'ada.dev', href: 'https://ada.dev' },
    ])
  })

  it('keeps the seed intact', () => {
    expect(pruneResumeForCv(RESUME_SEED).name).toBe(RESUME_SEED.name)
  })
})
