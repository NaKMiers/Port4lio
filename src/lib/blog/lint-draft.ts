import 'server-only'

import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'

import { findImagePlaceholders } from '@/lib/blog/image-placeholders'
import { auditProse, type ProseFinding } from '@/lib/blog/prose-audit'
import { isAllowedImageUrl } from '@/lib/blog/rehype-restrict-image-hosts'

/**
 * `lint_draft`: the owner's prose audit, plus a dry run of what the markdown pipeline would
 * do to the draft - without saving or rendering anything.
 *
 * ```
 *   auditProse(body, language, evidence, structure)   em dashes, banned phrases, parallel shape...
 *   remark-parse + gfm (the renderer's own first two steps)
 *      html nodes          ──▶ rawHtml         the renderer DROPS raw HTML
 *      image not a placeholder and not this site's Cloudinary ──▶ refusedImages  (a broken image)
 *      heading depth 1     ──▶ h1              the title is the page's only h1
 *   findImagePlaceholders  ──▶ placeholders, each with whether a prompt was given
 * ```
 *
 * Deterministic and cheap, so an agent can call it on every revision. It stops at parsing:
 * sanitising and highlighting only change what a clean draft looks like, not whether it is
 * clean.
 */

export interface LintInput {
  bodyMarkdown: string
  language: 'vi' | 'en'
  /** The material the post may cite. A specific found in here is sourced. */
  evidence?: string
  structure?: string
  imagePrompts?: { key: string }[]
}

export interface LintReport {
  clean: boolean
  prose: ProseFinding[]
  rawHtml: string[]
  refusedImages: string[]
  h1: boolean
  placeholders: { key: string; alt: string; hasPrompt: boolean }[]
}

const PLACEHOLDER_URL = /^image\d+$/

export function lintDraft(input: LintInput): LintReport {
  const prose = auditProse({
    bodyMarkdown: input.bodyMarkdown,
    language: input.language,
    evidence: input.evidence ?? '',
    structure: input.structure ?? '',
  })

  const rawHtml: string[] = []
  const refusedImages: string[] = []
  let h1 = false
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(input.bodyMarkdown)
  visit(tree, node => {
    if (node.type === 'html')
      rawHtml.push(
        String((node as { value?: string }).value ?? '').slice(0, 120)
      )
    if (node.type === 'image') {
      const url = String((node as { url?: string }).url ?? '')
      if (!PLACEHOLDER_URL.test(url) && !isAllowedImageUrl(url))
        refusedImages.push(url.slice(0, 200))
    }
    if (node.type === 'heading' && (node as { depth?: number }).depth === 1)
      h1 = true
  })

  const prompted = new Set((input.imagePrompts ?? []).map(entry => entry.key))
  const placeholders = findImagePlaceholders(input.bodyMarkdown).map(
    placeholder => ({
      ...placeholder,
      hasPrompt: prompted.has(placeholder.key),
    })
  )

  return {
    clean:
      prose.length === 0 &&
      rawHtml.length === 0 &&
      refusedImages.length === 0 &&
      !h1,
    prose,
    rawHtml,
    refusedImages,
    h1,
    placeholders,
  }
}
