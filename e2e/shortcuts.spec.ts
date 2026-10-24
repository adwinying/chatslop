import { expect, test } from '@playwright/test'
import { logIn } from '@/e2e/log-in'

test.beforeEach(async ({ page }) => {
  await logIn(page)
  await expect(page).toHaveURL('/')
})

test('Mod+K focuses Thread search from the composer', async ({ page }) => {
  await page.getByLabel('Message').click()
  await page.keyboard.press('ControlOrMeta+K')

  await expect(page.getByLabel('Search Threads')).toBeFocused()
})

test('Mod+K on a phone opens the sidebar to Thread search', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Message').click()
  await page.keyboard.press('ControlOrMeta+K')

  await expect(page.getByLabel('Search Threads')).toBeFocused()
  await expect(page.getByLabel('Search Threads')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Search Threads')).toBeHidden()
  await expect(page.getByLabel('Message')).toBeFocused()
})

test('Mod+Shift+O starts a new Thread', async ({ page }) => {
  await page.getByRole('link', { name: 'Admin' }).click()
  await expect(page).toHaveURL('/admin')

  await page.keyboard.press('ControlOrMeta+Shift+O')

  await expect(page).toHaveURL('/')
})

test('Mod+Shift+M opens the Model picker', async ({ page }) => {
  await page.getByLabel('Message').click()
  await page.keyboard.press('ControlOrMeta+Shift+M')

  await expect(page.getByLabel('Search Models')).toBeFocused()
})

test('Mod+Shift+E opens the Reasoning level', async ({ page }) => {
  await page.getByLabel('Message').click()
  await page.keyboard.press('ControlOrMeta+Shift+E')

  // The native picker itself is out of Playwright's reach.
  await expect(page.getByLabel('Reasoning level')).toBeFocused()
})
