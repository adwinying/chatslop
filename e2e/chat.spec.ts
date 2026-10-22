import { expect, test, type Page } from '@playwright/test'

// Runs against MOCK_MODEL, which dev.env sets: canned reasoning, one source,
// then "Mock Answer:", markdown, and word1 … word200 at about ten words a second.

async function logIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Username or email').fill('admin')
  await page.getByLabel('Password').fill('hogehoge')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page).toHaveURL('/')
}

/** The highest `wordN` the Answer shows so far. */
async function lastWord(page: Page) {
  const text = await page.getByRole('article', { name: 'Answer' }).innerText()
  return Math.max(0, ...[...text.matchAll(/word(\d+)/g)].map((m) => +m[1]!))
}

test('an Answer streams, resumes after a reload, and stops', async ({
  page,
}) => {
  await logIn(page)

  await expect(page.getByLabel('Model')).not.toHaveValue('')
  await page.getByLabel('Message').fill('Hello, mock')
  await page.getByLabel('Message').press('Enter')

  await expect(page).toHaveURL(/\/chat\/\w+$/)
  await expect(page.getByText('Hello, mock')).toBeVisible()
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toHaveAttribute('aria-busy', 'true')
  await expect(answer).toContainText('Mock Answer:')
  await expect(answer.getByRole('link', { name: 'example.com' })).toBeVisible()
  await expect(answer.getByRole('button', { name: 'Reasoning' })).toBeVisible()

  const beforeReload = await lastWord(page)
  await page.reload()

  // The Live answer picks up where it was and keeps growing.
  await expect(answer).toHaveAttribute('aria-busy', 'true')
  await expect(answer).toContainText('Mock Answer:')
  await expect.poll(() => lastWord(page)).toBeGreaterThan(beforeReload + 5)

  await page.getByRole('button', { name: 'Stop' }).click()

  await expect(answer.getByText('Stopped')).toBeVisible()
  await expect(answer).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  expect(await lastWord(page)).toBeLessThan(200)
})
