'use client'

import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { labelCls } from '@/components/settings/settings-utils'

/**
 * A text-to-image prompt, two lines tall, with copy and rewrite on the same row as its label.
 *
 * ```
 *   IMAGE PROMPT                              [copy] [rewrite]
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Isometric 3D render of a single fibre-optic cable split   │
 *   │ into two paths above a matte charcoal plane, ...          │
 *   └──────────────────────────────────────────────────────────┘
 * ```
 *
 * Used twice: under the cover image URL, and once per `![image](imageN)` placeholder under the
 * markdown textarea. One component, because the two are the same object - a prompt the author
 * copies into an image tool - and the only thing that differs is where the text is stored.
 *
 * ## Why two rows and not an auto-growing textarea
 *
 * The prompt is capped at 60 words by the rules it is generated under, and it exists to be
 * copied rather than read closely. A field that grows to fit would push the markdown textarea
 * - the thing being written - down the page by the height of four prompts, to show text whose
 * whole interaction is one button press. It scrolls instead, and `resize-y` is left on so an
 * author who does want to read it can drag it open.
 *
 * ## Why copy is an icon and not "Copy to clipboard"
 *
 * There are two of these per card and up to five cards. At that density a labelled button
 * turns the panel into a wall of repeated words, and the clipboard icon is one of the few
 * genuinely unambiguous ones. Both buttons carry `aria-label` and `title`, so the label is
 * present for a screen reader and on hover - it is only absent visually.
 *
 * ## The copied state is local, and deliberately not lifted
 *
 * Each field owns its own two-second "Copied" tick. Hoisting it to the panel would make it
 * one `copiedKey` shared across every card - which is correct until you copy two prompts in
 * quick succession and the first card's tick vanishes the moment the second is pressed.
 */
export default function ImagePromptField({
  id,
  label,
  prompt,
  busy = false,
  help,
  onChange,
  onRegenerate,
}: {
  id: string
  label: string
  prompt: string
  /** A rewrite is in flight for THIS prompt. Spins the rewrite button, blocks the textarea. */
  busy?: boolean
  help?: string
  onChange: (value: string) => void
  onRegenerate: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // A blocked clipboard costs the shortcut, not the prompt - the text is selectable in
      // the textarea right there. Surfacing an error banner for it would be louder than the
      // problem, which is why this is the one failure here that is swallowed.
    }
  }

  return (
    <div>
      <div className='mb-1.5 flex items-center justify-between gap-2'>
        <label className={`${labelCls} mb-0`} htmlFor={id}>
          {label}
        </label>
        <span className='flex items-center gap-1'>
          <button
            type='button'
            onClick={() => void copy()}
            // Nothing to put on the clipboard, and a button that silently copies an empty
            // string is a button that reports success for nothing.
            disabled={!prompt}
            aria-label={`Copy ${label.toLowerCase()}`}
            title='Copy'
            className={iconBtnCls}
          >
            {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
          </button>
          <button
            type='button'
            onClick={onRegenerate}
            disabled={busy}
            aria-label={`Write a new ${label.toLowerCase()}`}
            title='Write a new prompt'
            className={iconBtnCls}
          >
            <RefreshCw aria-hidden size={14} className={busy ? 'animate-spin' : ''} />
          </button>
        </span>
      </div>

      <textarea
        id={id}
        rows={2}
        value={prompt}
        disabled={busy}
        onChange={event => onChange(event.target.value)}
        placeholder='No prompt yet. Press the rewrite button to have one written from the post.'
        className='block w-full resize-y rounded-[1.05rem] border border-pp-line bg-white/78 px-4 py-2.5 font-mono text-[12px] leading-relaxed text-pp-text shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition placeholder:font-sans placeholder:text-pp-muted/75 focus:border-pp-blue/55 focus:bg-white focus:ring-4 focus:ring-pp-blue/10 disabled:opacity-60'
      />

      {busy ? (
        <p className='mt-1 flex items-center gap-1.5 text-xs text-pp-muted'>
          <Loader2 aria-hidden size={12} className='animate-spin' />
          Writing a prompt from the post...
        </p>
      ) : help ? (
        <p className='mt-1 text-xs leading-relaxed text-pp-muted'>{help}</p>
      ) : null}
    </div>
  )
}

/** Shared by both buttons here and by the upload/apply pair in `MissingImagesPanel`. */
export const iconBtnCls =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-pp-line bg-white/82 text-pp-muted transition hover:bg-white hover:text-pp-text disabled:cursor-not-allowed disabled:opacity-40'
