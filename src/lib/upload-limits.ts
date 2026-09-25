export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // 4 MiB

export const MAX_PROFILE_JSON_BYTES = 4 * 1024 * 1024 // 4 MiB

/**
 * Multi-CV bounds (multi-cv-plan.md D8). A resume is ~10-20 KB and `GET /api/admin/cvs`
 * returns every CV with its resume so switching is instant, so the count cap is what keeps
 * that payload bounded (~400 KB worst case). The body cap is per request: one CV, well
 * above any real one and far below the profile's 4 MiB.
 */
export const MAX_CVS = 20

export const MAX_CV_JSON_BYTES = 256 * 1024 // 256 KiB

/** A CV's name in the settings dropdown (D6). Here, not in the model, so the client can read it. */
export const CV_LABEL_MAX = 60

export function formatMaxUploadMb(): string {
  return String(MAX_UPLOAD_BYTES / (1024 * 1024))
}
