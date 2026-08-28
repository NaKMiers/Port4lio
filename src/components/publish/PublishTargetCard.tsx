'use client'

import CopyButton from '@/components/publish/CopyButton'
import CopyField from '@/components/publish/CopyField'
import DriftBadge from '@/components/publish/DriftBadge'
import {
  helpTextCls,
  itemCardCls,
  labelCls,
  primaryBtnCls,
  textareaCls,
} from '@/components/settings/settings-utils'
import type { PublishTargetWithDrift } from '@/lib/publish/types'

function AutoArtifact({ target }: { target: PublishTargetWithDrift }) {
  const { artifact, drift } = target

  return (
    <div className='space-y-3'>
      <p className={helpTextCls}>
        Applied automatically by the <strong>publish-profile</strong> workflow. Nothing to paste —
        this is a preview of what it will write.
        {drift.detail ? ` Last run: ${drift.detail}.` : ''}
      </p>

      {artifact.kind === 'file' ? (
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <label className={labelCls}>{artifact.path}</label>
            <CopyButton value={artifact.content} label='Copy markdown' />
          </div>
          <textarea className={textareaCls} rows={14} readOnly value={artifact.content} />
        </div>
      ) : null}

      {artifact.kind === 'fields-object' ? (
        <dl className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          {(['name', 'bio', 'blog', 'location', 'company'] as const).map(key => (
            <div key={key} className='rounded-[1rem] border border-pp-line bg-white/60 px-3 py-2'>
              <dt className={labelCls}>{key}</dt>
              <dd className='break-words text-sm text-pp-text'>{artifact[key] || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

export default function PublishTargetCard({
  target,
  onAcknowledge,
  acknowledging,
}: {
  target: PublishTargetWithDrift
  onAcknowledge: (target: PublishTargetWithDrift) => void
  acknowledging: boolean
}) {
  const isManual = target.mode === 'manual'

  return (
    <div className={itemCardCls}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-sm font-semibold text-pp-text'>{target.label}</h2>
          <p className={`${helpTextCls} mt-0.5`}>
            {isManual ? 'Copy and paste — no write API exists' : 'Automated'} · v
            {target.version.slice(0, 8)}
          </p>
        </div>
        <DriftBadge drift={target.drift} />
      </div>

      <div className='mt-4'>
        {isManual && target.artifact.kind === 'fields' ? (
          <div className='space-y-5'>
            {target.artifact.fields.map(field => (
              <CopyField key={field.key} field={field} />
            ))}
          </div>
        ) : (
          <AutoArtifact target={target} />
        )}
      </div>

      {isManual ? (
        <div className='mt-4 flex justify-end'>
          <button
            type='button'
            className={primaryBtnCls}
            disabled={target.drift.inSync || acknowledging}
            onClick={() => onAcknowledge(target)}
          >
            {target.drift.inSync ? 'Up to date' : acknowledging ? 'Saving…' : 'Mark as pasted'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
