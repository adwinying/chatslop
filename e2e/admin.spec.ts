import { expect, test, type Page } from '@playwright/test'

async function logIn(page: Page, username = 'admin', password = 'hogehoge') {
  await page.goto('/login')
  await page.getByLabel('Username or email').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

test('an Admin creates a User, who logs in until disabled', async ({
  page,
  browser,
}) => {
  // Unique per run, since the dev deployment outlives it.
  const username = `e2e_${Date.now()}`
  const password = 'e2e-password-123'
  await logIn(page)
  await page.getByRole('link', { name: 'Admin' }).click()

  const form = page.getByRole('form', { name: 'New User' })
  await form.getByLabel('Username').fill(username)
  await form.getByLabel('Password').fill(password)
  await form.getByRole('button', { name: 'Create' }).click()
  const row = page.getByRole('row').filter({ hasText: username })
  await expect(row).toContainText(`${username}@users.invalid`)

  const asUser = async () => {
    const context = await browser.newContext()
    const userPage = await context.newPage()
    await logIn(userPage, username, password)
    return userPage
  }
  await expect(await asUser()).toHaveURL('/')

  await row.getByRole('button', { name: 'Disable' }).click()
  await expect(row.getByRole('button', { name: 'Enable' })).toBeVisible()
  const refused = await asUser()
  await expect(refused.getByRole('alert')).toBeVisible()
  await expect(refused).toHaveURL('/login')

  // Leaves the deployment as seeded for the next run.
  page.once('dialog', (dialog) => void dialog.accept())
  await row.getByRole('button', { name: 'Delete' }).click()
  await expect(row).toHaveCount(0)
})

test("a Model an Admin disables leaves the User's options", async ({
  page,
}) => {
  await logIn(page)
  await expect(page).toHaveURL('/')

  // Back and forward stay in the app, so no reload drops a pending toggle.
  const luna = page.getByLabel('Model').getByRole('option', {
    name: 'GPT-6 Luna',
  })
  const enabled = page.getByRole('checkbox', { name: 'Enable GPT-6 Luna' })
  await page.getByRole('link', { name: 'Admin' }).click()
  await expect(page).toHaveURL('/admin')
  // Seeding synced it from models.dev; a failed run may have left it off.
  await enabled.check()
  await page.goBack()
  await expect(luna).toHaveCount(1)

  await page.goForward()
  await enabled.uncheck()
  await page.goBack()
  await expect(page.getByLabel('Model').getByRole('option')).not.toHaveCount(0)
  await expect(luna).toHaveCount(0)

  // Leaves the deployment as seeded for the next run.
  await page.goForward()
  await enabled.check()
  await page.goBack()
  await expect(luna).toHaveCount(1)
})
