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
  // The native picker is out of Playwright's reach, so record the call.
  await page.evaluate(() => {
    HTMLSelectElement.prototype.showPicker = function () {
      this.dataset.picked = ''
    }
  })
  await page.getByLabel('Message').click()
  await page.keyboard.press('ControlOrMeta+Shift+E')

  const reasoning = page.getByLabel('Reasoning level')
  await expect(reasoning).toBeFocused()
  await expect(reasoning).toHaveAttribute('data-picked')
})

test('shortcut targets announce their keys', async ({ page }) => {
  await expect(page.getByLabel('Search Threads')).toHaveAttribute(
    'aria-keyshortcuts',
    'Meta+K Control+K',
  )
  await expect(page.getByRole('link', { name: 'New Chat' })).toHaveAttribute(
    'aria-keyshortcuts',
    'Meta+Shift+O Control+Shift+O',
  )
})
