import { describe, expect, it } from 'vitest'

import { renderExportHtml } from '@/components/whiteboard/export-html'
import { renderContext } from '@/lib/whiteboard/context'

import { item } from './whiteboard-fixture'

/**
 * The Export sheet's reading view. It is display only - Copy carries the markdown - but it
 * is still HTML built from owner text, so the sanitizing is what these pin down.
 */
describe('renderExportHtml', () => {
  it('renders the export shape: headings, the meta line, a quoted body, to-do rows', async () => {
    const { markdown } = renderContext({
      items: [
        item(1, { title: 'Ship it', meaning: 'goal', body: 'Why it matters' }),
        item(2, {
          form: 'todo',
          title: 'List',
          todos: [{ id: 'a', text: 'Row', done: true }],
        }),
      ],
      frames: [],
      neighbours: [],
      links: [],
    })
    const html = await renderExportHtml(markdown)
    expect(html).toContain('<h1>Whiteboard</h1>')
    expect(html).toContain('<h4>Ship it</h4>')
    expect(html).toContain('<blockquote>')
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/)
    expect(html).not.toContain('####')
  })

  it('never turns card text into markup', async () => {
    const html = await renderExportHtml(
      [
        '#### <img src=x onerror="alert(1)">',
        '> <script>alert(2)</script>',
        '[click](javascript:alert(3))',
      ].join('\n\n')
    )
    expect(html).not.toMatch(/<img|<script|onerror|javascript:/i)
  })
})
