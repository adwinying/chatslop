import type { Page } from '@playwright/test'

/** Submits the login form, as the seeded Admin unless told otherwise. */
export async function logIn(
  page: Page,
  username = 'admin',
  password = 'hogehoge',
) {
  await page.goto('/login')
  await page.getByLabel('Username or email').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}
