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

  await expect(page.getByRole('button', { name: /^Model: / })).toBeVisible()
  await page.getByLabel('Message').fill('Hello, mock')
  await page.getByLabel('Message').press('Enter')

  await expect(page).toHaveURL(/\/chat\/\w+$/)
  await expect(page.getByRole('article', { name: 'Prompt' })).toHaveText(
    'Hello, mock',
  )
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

test('a Model picked by keyboard persists after sending and reloading', async ({
  page,
}) => {
  await logIn(page)
  const picker = page.getByRole('button', { name: /^Model: / })
  const reasoning = page.getByLabel('Reasoning level')
  // The dev database remembers earlier runs, so pick something else each time.
  const model = (await picker.textContent())?.includes('Haiku')
    ? 'Sonnet'
    : 'Haiku'
  const level = (await reasoning.inputValue()) === 'high' ? 'low' : 'high'

  await picker.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.type(model.toLowerCase())
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAccessibleName(new RegExp(model))
  await reasoning.selectOption(level)
  await page.getByLabel('Message').fill('Pick me')
  await page.getByLabel('Message').press('Enter')
  await expect(page).toHaveURL(/\/chat\/\w+$/)
  await page.reload()

  await expect(picker).toHaveAccessibleName(new RegExp(model))
  await expect(reasoning).toHaveValue(level)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('article', { name: 'Answer' })).toContainText(
    new RegExp(`${model} [\\d.]+ · ${level}`),
  )
})

test('a new Thread gets its title, then is renamed, pinned and deleted', async ({
  page,
}) => {
  await logIn(page)
  await page.getByLabel('Message').fill('Title me')
  await page.getByLabel('Message').press('Enter')
  await expect(page).toHaveURL(/\/chat\/\w+$/)

  const header = page.locator('header')
  const threads = page.getByRole('navigation', { name: 'Threads' })
  await expect(header.getByRole('button', { name: 'Mock title' })).toBeVisible()

  const name = `Renamed ${Date.now()}`
  await header.getByRole('button', { name: 'Mock title' }).click()
  await header.getByLabel('Title').fill(name)
  await header.getByLabel('Title').press('Enter')
  await expect(header.getByRole('button', { name })).toBeVisible()
  const row = threads.getByRole('listitem').filter({ hasText: name })
  await expect(row).toBeVisible()

  await row.hover()
  await row.getByRole('button', { name: 'Pin' }).click()
  await expect(
    threads.getByRole('region', { name: 'Pinned' }).getByText(name),
  ).toBeVisible()

  // The sidebar outlives navigation, so a double-click renames a closed Thread.
  await page.getByRole('link', { name: 'New Chat' }).click()
  await expect(page).toHaveURL('/')
  const renamed = `${name} again`
  await threads.getByRole('link', { name }).dblclick()
  await threads.getByLabel('Title').fill(renamed)
  await threads.getByLabel('Title').press('Enter')
  await expect(header.getByRole('button', { name: renamed })).toBeVisible()

  // Mid-Answer, so the delete stops the Live answer too.
  await header.getByRole('button', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page).toHaveURL('/')
  await expect(threads.getByText(name)).toHaveCount(0)
})

test('the phone sidebar closes with Escape and returns focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await logIn(page)
  const menu = page.getByRole('button', { name: 'Open sidebar' })
  const threads = page.getByRole('navigation', { name: 'Threads' })

  await menu.click()
  await expect(threads).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Close sidebar' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')

  await expect(threads).toBeHidden()
  await expect(menu).toBeFocused()
})
