'use client'

import { Check, ImageUp, Loader2 } from 'lucide-react'
import { useState } from 'react'

import GenerateBlogButton from '@/components/blog-admin/GenerateBlogButton'
import ImagePromptField, {
  iconBtnCls,
} from '@/components/blog-admin/ImagePromptField'
import SelectField from '@/components/settings/SelectField'
import { inputCls } from '@/components/settings/settings-utils'
import { IMAGE_MODEL_SELECT_OPTIONS } from '@/lib/blog/generation-fields'
import type { ImagePlaceholder } from '@/lib/blog/image-placeholders'

/**
 * One card per unresolved `![image](imageN)`, under the markdown textarea.
 *
 * ```
 *   ┌─ image1 ────────────────────────────────────────────────┐
 *   │  IMAGE PROMPT                        [copy] [rewrite]   │
 *   │  ┌────────────────────────────────────────────────────┐ │
 *   │  │ Isometric 3D render of ...                         │ │
 *   │  └────────────────────────────────────────────────────┘ │
 *   │  [ https://... paste the URL here ]      [apply] [upload]│
 *   └─────────────────────────────────────────────────────────┘
 * ```
 *
 * ## A card is a task, and it disappears when the task is done
 *
 * The list is derived from the placeholders currently in the markdown, not from a stored
 * to-do list. Applying a URL rewrites `(image1)` to `(https://...)` in the body, the
 * placeholder stops existing, and the card goes with it - so the panel is empty exactly when
 * there is nothing left to do, without anything having to mark it complete.
 *
 * It works in the other direction too, which is the part a stored list would get wrong:
 * typing `![image](image9)` into the body by hand produces a card for it, with a rewrite
 * button that writes a prompt from the paragraph it sits in.
 *
 * ## Why the URL field needs an explicit apply and the upload button does not
 *
 * Applying is destructive to the placeholder, and the placeholder is what keeps the card on
 * screen. Wired to `onChange`, the card would vanish after the first character of a pasted
 * URL - taking the input being typed into with it - and leave `![image](h)` in the body. So
 * the URL commits on Enter or on the tick, and only when it parses as http(s).
 *
 * An upload has no partial state: the file either finished uploading or it did not, and the
 * URL that comes back is already complete. It applies itself.
 */
export default function MissingImagesPanel({
  placeholders,
  promptFor,
  busyKey,
  uploadingKey,
  generatingKey,
  imageModel,
  imageGenError,
  imageGenErrorSource,
  onPromptChange,
  onRegenerate,
  onResolve,
  onUpload,
  onImageModelChange,
  onGenerateImage,
}: {
  placeholders: ImagePlaceholder[]
  /** The stored prompt for a key, or '' when the model did not return one. */
  promptFor: (key: string) => string
  /** Which key has a prompt rewrite in flight, if any. */
  busyKey: string | null
  /** Which key has an upload in flight, if any. */
  uploadingKey: string | null
  /** Which key has an image generation call in flight, if any. */
  generatingKey: string | null
  /** The model chosen for Generate - one selection, shared by every card and the cover. */
  imageModel: string
  /**
   * The last generation failure, if any - shared with the cover's own model row for the same
   * reason `imageModel` is: one generation call is ever in flight at a time, cover or
   * placeholder. `imageGenErrorSource` is which one it belongs to (a placeholder key, or
   * `'cover'`), so it renders under exactly the row that produced it and not every card.
   */
  imageGenError: string | null
  imageGenErrorSource: string | null
  onPromptChange: (key: string, value: string) => void
  onRegenerate: (key: string) => void
  onResolve: (key: string, url: string) => void
  onUpload: (key: string, file: File) => void
  onImageModelChange: (value: string) => void
  onGenerateImage: (key: string) => void
}) {
  if (placeholders.length === 0) return null

  return (
    <div className="mt-4 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pp-muted">
        Images to make ({placeholders.length})
      </p>

      {placeholders.map(placeholder => (
        <PlaceholderCard
          key={placeholder.key}
          placeholder={placeholder}
          prompt={promptFor(placeholder.key)}
          busy={busyKey === placeholder.key}
          uploading={uploadingKey === placeholder.key}
          generating={generatingKey === placeholder.key}
          imageModel={imageModel}
          error={imageGenErrorSource === placeholder.key ? imageGenError : null}
          onPromptChange={value => onPromptChange(placeholder.key, value)}
          onRegenerate={() => onRegenerate(placeholder.key)}
          onResolve={url => onResolve(placeholder.key, url)}
          onUpload={file => onUpload(placeholder.key, file)}
          onImageModelChange={onImageModelChange}
          onGenerateImage={() => onGenerateImage(placeholder.key)}
        />
      ))}
    </div>
  )
}

function PlaceholderCard({
  placeholder,
  prompt,
  busy,
  uploading,
  generating,
  imageModel,
  error,
  onPromptChange,
  onRegenerate,
  onResolve,
  onUpload,
  onImageModelChange,
  onGenerateImage,
}: {
  placeholder: ImagePlaceholder
  prompt: string
  busy: boolean
  uploading: boolean
  generating: boolean
  imageModel: string
  error: string | null
  onPromptChange: (value: string) => void
  onRegenerate: () => void
  onResolve: (url: string) => void
  onUpload: (file: File) => void
  onImageModelChange: (value: string) => void
  onGenerateImage: () => void
}) {
  const [url, setUrl] = useState('')
  const ready = isHttpUrl(url)

  const apply = () => {
    if (!ready) return
    onResolve(url.trim())
    setUrl('')
  }

  return (
    <div className="bg-white/62 rounded-[1.2rem] border border-pp-line p-3.5">
      <div className="mb-2 flex items-baseline gap-2">
        <code className="bg-pp-text/8 rounded-full px-2 py-0.5 font-mono text-[11px] text-pp-text">
          {placeholder.key}
        </code>
        <span className="truncate text-xs text-pp-muted">
          {placeholder.alt ? `alt: ${placeholder.alt}` : 'no alt text'}
        </span>
      </div>

      <ImagePromptField
        id={`image-prompt-${placeholder.key}`}
        label="Image prompt"
        prompt={prompt}
        busy={busy}
        onChange={onPromptChange}
        onRegenerate={onRegenerate}
      />

      <div className="mt-2.5 flex items-center gap-1.5">
        <input
          className={`${inputCls} py-2 text-[13px]`}
          value={url}
          placeholder="Paste a res.cloudinary.com URL, or upload"
          disabled={uploading}
          onChange={event => setUrl(event.target.value)}
          // Enter as well as the tick. This input's entire content is a pasted string
          // followed by a commit, and Enter is what a keyboard reaches for after a paste.
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
        />
        <button
          type="button"
          onClick={apply}
          disabled={!ready || uploading}
          aria-label={`Use this URL for ${placeholder.key}`}
          title="Use this URL"
          className={iconBtnCls}
        >
          <Check
            aria-hidden
            size={14}
          />
        </button>

        {/*
          A label wrapping a hidden input, rather than a button that clicks one. `<input
          type='file'>` cannot be opened from script without a real user gesture in some
          browsers, and a label is the one construct that is a button for the pointer, a
          button for the keyboard, and still the input for the file dialog.
        */}
        <label
          className={`${iconBtnCls} ${uploading ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`}
          title="Upload an image"
        >
          {uploading ? (
            <Loader2
              aria-hidden
              size={14}
              className="animate-spin"
            />
          ) : (
            <ImageUp
              aria-hidden
              size={14}
            />
          )}
          <span className="sr-only">Upload an image for {placeholder.key}</span>
          <input
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            disabled={uploading}
            onChange={event => {
              const file = event.target.files?.[0]
              // Cleared before the upload, so picking the same file twice after a failure
              // fires `change` again. Without it the second pick is a no-op and looks broken.
              event.target.value = ''
              if (file) onUpload(file)
            }}
          />
        </label>
      </div>

      {/*
        At the bottom of the card, below the URL row rather than beside the prompt's own
        copy/rewrite icons above - same placement `BlogEditor`'s cover section uses. Self-
        applying like the upload button next to it: a generated image has no partial state
        either, so there is nothing for a separate "use this" press to commit.
      */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <SelectField
          id={`image-model-${placeholder.key}`}
          ariaLabel="Image generation model"
          value={imageModel}
          options={IMAGE_MODEL_SELECT_OPTIONS}
          onChange={onImageModelChange}
          className="min-w-[14rem] flex-1"
        />
        <GenerateBlogButton
          label={generating ? 'Generating...' : 'Generate image'}
          onClick={onGenerateImage}
          disabled={!imageModel || generating}
        />
      </div>
      {error ? (
        // `span`, not `p` - see the matching comment in `BlogEditor`'s cover section for why.
        <span className="mt-2 block text-xs font-medium text-pp-ink-rose">
          {error}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The image host, checked at the input rather than discovered on the published page.
 *
 * This used to accept any `http(s)` URL, and its own comment claimed that caught the failure
 * it does not: `rehypeRestrictImageHosts` requires `https`, the host `res.cloudinary.com`, AND
 * a path under this site's cloud name. So pasting `https://cdn.some-tool.ai/out/abc.png` -
 * exactly what you get back from an external image generator, which is the whole workflow
 * these prompts exist to feed - passed, was written into the body, made the card disappear and
 * cleared the missing-images banner, and then published as `<img alt="image">`: a broken-image
 * icon on a live post, with every signal in the editor saying it was resolved.
 *
 * The cloud-name half of the rule cannot be checked here. `CLOUDINARY_CLOUD_NAME` is a
 * server-only variable and this is a client component, so the host check is the part that
 * travels; a URL from the wrong Cloudinary ACCOUNT is still refused server-side at render.
 * That is fine - the common mistake is the wrong host, not the wrong account.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'
  } catch {
    return false
  }
}
