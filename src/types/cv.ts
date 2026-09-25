import type { Resume } from '@/types/profile'

/**
 * One CV as `/api/admin/cvs` sends it to the settings editor. Dates are ISO strings;
 * `updatedAt` is the base Save CV sends back (the stale-tab guard). `fitVerified` is false
 * after an agent wrote the CV and until the owner's next Save CV (multi-cv-plan.md P2-A).
 */
export type CvDto = {
  id: string
  label: string
  resume: Resume
  publishedAt: string | null
  updatedAt: string
  fitVerified: boolean
}

/** `GET /api/admin/cvs`. `publishedId` is the CV `/cv` prints. */
export type CvListDto = {
  cvs: CvDto[]
  publishedId: string | null
}
