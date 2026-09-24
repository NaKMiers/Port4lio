import { RefreshCw, TriangleAlert, Upload } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Props {
  onReload: () => void
  onOverwrite: () => void
  busy?: boolean
  /** What changed, for the sentence: the blog editor's post, or the settings profile. */
  subject?: 'post' | 'profile'
  className?: string
}

/**
 * Shown when Save was refused because the post changed after this tab loaded it (R9) -
 * almost always an agent's `update_post` or an image run through the site MCP. The settings
 * editor shows it too (`subject="profile"`), for an agent's `update_profile`.
 *
 * Reload discards what is on screen and loads the server's copy. Overwrite anyway resends the
 * save without the staleness check, which is the old behaviour, chosen on purpose.
 */
export default function StaleSaveBanner({
  onReload,
  onOverwrite,
  busy,
  subject = 'post',
  className,
}: Props) {
  return (
    <div
      role="alert"
      data-testid={
        subject === 'post' ? 'blog-stale-banner' : 'profile-stale-banner'
      }
      className={cn(
        'mb-6 flex flex-wrap items-center gap-3 rounded-[1.35rem] border border-[rgba(163,110,47,0.22)] bg-[rgba(233,176,97,0.14)] px-4 py-3 text-sm text-[#6b4515] shadow-[0_12px_28px_rgba(107,69,21,0.08)]',
        className
      )}
    >
      <TriangleAlert
        aria-hidden
        size={16}
        className="shrink-0"
      />
      <p className="min-w-0 flex-1 font-medium">
        This {subject} changed since you opened it - probably an agent edit.
        Reload to see it (your unsaved changes here are dropped), or overwrite
        it with what you have.
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onReload}
          disabled={busy}
          className="border-current/20 inline-flex items-center gap-1.5 rounded-full border bg-white/80 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
        >
          <RefreshCw
            aria-hidden
            size={13}
          />
          Reload
        </button>
        <button
          type="button"
          onClick={onOverwrite}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#6b4515] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          <Upload
            aria-hidden
            size={13}
          />
          Overwrite anyway
        </button>
      </div>
    </div>
  )
}
