import { expect, test } from '@playwright/test'

import { STORAGE_STATE } from './global-setup'

/**
 * Multi-CV, end to end under `next start` (multi-cv-plan.md D7, OV-11, OV-12).
 *
 * ```
 *   GET /cv once                        ──▶ an ISR entry exists to go stale
 *   /admin/settings, CV tab             ──▶ Save profile hidden, Save CV shown
 *   New (per-run label) ──▶ change the name ──▶ Save CV ──▶ Publish
 *   GET /cv, no wait                    ──▶ the new name, on the FIRST full load (expire: 0)
 *   Delete on the published CV          ──▶ disabled in the UI, 409 from the API
 *   cleanup                             ──▶ the original CV published back, the test CV deleted
 * ```
 *
 * `/cv` is loaded before the publish on purpose, as `taxonomy-revalidate.spec.ts` does: with
 * no cached entry there is nothing stale to serve, and the freshness check would pass no
 * matter what the service revalidated. The label is per run and the cleanup always runs, so
 * repeated runs neither fill MAX_CVS nor leave a test CV live.
 *
 * Runs only against a disposable database (global-setup refuses anything else).
 */
test.use({ storageState: STORAGE_STATE })
test.describe.configure({ mode: 'serial' })

const RUN = Date.now()

type Listed = {
  cvs: { id: string; label: string }[]
  publishedId: string
}

test('a new CV, saved and published, is what /cv prints on the next load', async ({
  page,
  request,
}) => {
  const label = `E2E CV ${RUN}`
  const name = `E2E NAME ${RUN}`

  // 1. Warm the /cv cache with whatever is published now.
  const before = await request.get('/cv')
  expect(before.ok()).toBe(true)
  expect(await before.text()).not.toContain(name)

  await page.goto('/admin/settings')
  await page.getByRole('tab', { name: /^CV/ }).click()
  await expect(page.getByTestId('cv-picker')).toBeVisible()

  // The GET that rendered the picker migrated, so the original is known now.
  const original = (await (
    await request.get('/api/admin/cvs')
  ).json()) as Listed
  const originalId = original.publishedId
  let testId: string | null = null

  try {
    // 2. Save profile is not shown on this tab; Save CV is the one save button (R5).
    await expect(
      page.getByRole('button', { name: 'Save profile' })
    ).toHaveCount(0)
    const saveCv = page.getByTestId('save-cv')
    await expect(saveCv).toBeVisible()

    // 3. New: a copy of the selected CV, selected once created.
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.getByRole('dialog', { name: 'New CV' })
    await dialog.getByLabel('CV name').fill(label)
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(dialog).toBeHidden()

    const listed = (await (
      await request.get('/api/admin/cvs')
    ).json()) as Listed
    testId = listed.cvs.find(cv => cv.label === label)?.id ?? null
    expect(testId).not.toBeNull()
    expect(listed.publishedId).toBe(originalId)

    // 4. Edit the name, then Save CV.
    const masthead = page.locator('details', { hasText: 'CV Masthead' })
    await masthead.locator('label:text-is("Name") + input').fill(name)
    await expect(page.getByTestId('cv-dirty')).toBeVisible()
    // Publish is off while dirty: only the saved CV can go live.
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled()
    await saveCv.click()
    await expect(page.getByTestId('cv-dirty')).toBeHidden()

    // 5. Publish it.
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled()
    await expect(
      page.getByRole('combobox').filter({ hasText: `${label} (Published)` })
    ).toBeVisible()

    // 6. The very next full load of /cv is the new CV. No wait, no retry.
    const after = await request.get('/cv')
    expect(after.ok()).toBe(true)
    const html = await after.text()
    expect(html).toContain(name)

    // 7. The published CV cannot be deleted: disabled here, refused by the server.
    await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled()
    const refused = await request.delete(`/api/admin/cvs/${testId}`)
    expect(refused.status()).toBe(409)
    expect((await refused.json()).code).toBe('published')
  } finally {
    // Leave the disposable database as the run found it: original live, test CV gone.
    await request.post(`/api/admin/cvs/${originalId}/publish`)
    if (testId) await request.delete(`/api/admin/cvs/${testId}`)
  }

  const restored = await request.get('/cv')
  expect(await restored.text()).not.toContain(name)
})
