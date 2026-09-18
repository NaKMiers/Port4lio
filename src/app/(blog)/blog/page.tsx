/**
 * Placeholder. Replaced by the real index in T7.
 *
 * It exists now so that T1 can prove the thing T1 is actually about: that `(blog)/blog` and
 * `(admin)/admin/blog` resolve to different paths and the build survives both. The plan
 * recorded `You cannot have two parallel pages that resolve to the same path` as a
 * reproduced failure of the earlier `(blog)/blog` + `(admin)/blog` shape (F1), so the route
 * skeleton is worth landing and building before any content depends on it.
 */
export default function BlogIndexPage() {
  return null
}
