import CopyButton from '@/components/publish/CopyButton'
import { helpTextCls, labelCls, textareaCls } from '@/components/settings/settings-utils'
import type { ManualField } from '@/lib/publish/types'

/** Rows scale with content so long fields do not need scrolling to review. */
function rowsFor(value: string): number {
  const lines = value.split('\n').length
  return Math.min(16, Math.max(2, lines + 1))
}

export default function CopyField({ field }: { field: ManualField }) {
  const counterCls = field.overflow ? 'text-[#7f2f2f]' : 'text-pp-muted'

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <label className={labelCls}>{field.label}</label>
        <span className={`text-[11px] font-semibold tracking-[0.12em] ${counterCls}`}>
          {field.sourceLength} / {field.limit}
          {field.overflow ? ' · trimmed' : ''}
        </span>
      </div>

      <textarea className={textareaCls} rows={rowsFor(field.value)} readOnly value={field.value} />

      <div className='flex flex-wrap items-center justify-between gap-2'>
        {field.hint ? <p className={helpTextCls}>{field.hint}</p> : <span />}
        <CopyButton value={field.value} />
      </div>

      {field.overflow ? (
        <p className={`${helpTextCls} text-[#7f2f2f]`}>
          Source is {field.sourceLength - field.limit} characters over the platform limit. The text
          above is already trimmed and safe to paste, but shortening the source reads better.
        </p>
      ) : null}
    </div>
  )
}
