import { expect, test } from '@playwright/test'

test("a Model an Admin disables leaves the User's options", async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Username or email').fill('admin')
  await page.getByLabel('Password').fill('hogehoge')
  await page.getByRole('button', { name: 'Log in' }).click()
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
