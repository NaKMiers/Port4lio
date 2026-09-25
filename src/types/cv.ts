import type { Resume } from '@/types/profile'

/**
 * One CV as `/api/admin/cvs` sends it to the settings editor. Dates are ISO strings;
 * `updatedAt` is the base Save CV sends back (the stale-tab guard).
 */
export type CvDto = {
  id: string
  label: string
  resume: Resume
  publishedAt: string | null
  updatedAt: string
}

/** `GET /api/admin/cvs`. `publishedId` is the CV `/cv` prints. */
export type CvListDto = {
  cvs: CvDto[]
  publishedId: string | null
}
