'use client'

import { Globe, Pencil, Plus, Trash2 } from 'lucide-react'

import SelectField from '@/components/settings/SelectField'
import type { CvActionGates } from '@/components/settings/cv-editor-state'
import { cn } from '@/lib/utils'
import type { CvDto } from '@/types/cv'

interface Props {
  cvs: CvDto[]
  selectedId: string
  publishedId: string | null
  dirty: boolean
  /** The on-open fit moved the page break (D9). */
  refitted: boolean
  gates: CvActionGates
  onSelect: (id: string) => void
  onNew: () => void
  onRename: () => void
  onPublish: () => void
  onDelete: () => void
  className?: string
}

/** Icon-only: the label is the accessible name (`aria-label`) and the tooltip says more. */
const iconBtnCls =
  'inline-flex h-10 w-10 flex-none items-center justify-center rounded-full border border-pp-line bg-white/82 text-pp-text shadow-[0_8px_20px_rgba(46,35,28,0.06)] transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0'

/**
 * The CV tab's header: which CV is being edited, and what can be done to it. One row.
 *
 * ```
 *   [ Frontend CV (Published) v ] (+) (pencil) (globe) (bin)  Unsaved
 *   Page break re-fitted - Save CV to keep it                 (only after an on-open refit)
 * ```
 *
 * It used to be a labelled card with four text buttons and a help line - most of a screen
 * on a phone for one dropdown. The label is now screen-reader only, the buttons are icons
 * whose names stay New / Rename / Publish / Delete (`aria-label`, which the e2e spec finds
 * them by), and "the published CV is what /cv shows" lives in Publish's tooltip beside the
 * "(Published)" the dropdown already prints.
 *
 * Presentational: every rule about when an action is allowed is `cvActionGates` in
 * `cv-editor-state.ts`, and every confirm lives with the caller. The dropdown is
 * `SelectField` (AGENTS.md: dropdowns use it, not a native `<select>`).
 */
export default function CvPicker({
  cvs,
  selectedId,
  publishedId,
  dirty,
  refitted,
  gates,
  onSelect,
  onNew,
  onRename,
  onPublish,
  onDelete,
  className,
}: Props) {
  const options = cvs.map(cv => ({
    value: cv.id,
    label: cv.id === publishedId ? `${cv.label} (Published)` : cv.label,
  }))
  const waitTitle = gates.locked
    ? 'Waiting for the CV photo upload to finish'
    : undefined

  return (
    <div
      data-testid="cv-picker"
      className={cn('space-y-1.5', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="cv-picker-select"
          className="sr-only"
        >
          CV being edited
        </label>
        <SelectField
          id="cv-picker-select"
          value={selectedId}
          options={options}
          onChange={onSelect}
          disabled={!gates.canSelect}
          className="min-w-[12rem] flex-1"
        />

        <button
          type="button"
          aria-label="New"
          className={iconBtnCls}
          onClick={onNew}
          disabled={!gates.canCreate}
          title={
            waitTitle ?? 'New CV, copied from the saved version of this one'
          }
        >
          <Plus
            aria-hidden
            size={15}
          />
        </button>
        <button
          type="button"
          aria-label="Rename"
          className={iconBtnCls}
          onClick={onRename}
          disabled={!gates.canRename}
          title="Rename"
        >
          <Pencil
            aria-hidden
            size={14}
          />
        </button>
        <button
          type="button"
          aria-label="Publish"
          className={iconBtnCls}
          onClick={onPublish}
          disabled={!gates.canPublish}
          title={gates.publishTitle ?? 'Publish: make this the CV /cv shows'}
        >
          <Globe
            aria-hidden
            size={14}
          />
        </button>
        <button
          type="button"
          aria-label="Delete"
          className={cn(
            iconBtnCls,
            'border-red-200 text-red-700 hover:bg-red-50'
          )}
          onClick={onDelete}
          disabled={!gates.canDelete}
          title={gates.deleteTitle ?? 'Delete'}
        >
          <Trash2
            aria-hidden
            size={14}
          />
        </button>

        {dirty ? (
          <span
            data-testid="cv-dirty"
            className="text-xs font-semibold text-pp-orange"
          >
            Unsaved
          </span>
        ) : null}
      </div>
      {refitted && dirty ? (
        <p className="px-1 text-xs font-medium text-pp-text">
          Page break re-fitted - Save CV to keep it
        </p>
      ) : null}
    </div>
  )
}
