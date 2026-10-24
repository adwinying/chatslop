import { expect, test, type Page } from '@playwright/test'
import { logIn } from '@/e2e/log-in'

// Runs against MOCK_MODEL, which dev.env sets: canned reasoning, one source,
// then "Mock Answer:", markdown, and word1 … word200 at about ten words a second.

test.beforeEach(async ({ page }) => {
  await logIn(page)
  await expect(page).toHaveURL('/')
})

/** The highest `wordN` the Answer shows so far. */
async function lastWord(page: Page) {
  const text = await page.getByRole('article', { name: 'Answer' }).innerText()
  return Math.max(0, ...[...text.matchAll(/word(\d+)/g)].map((m) => +m[1]!))
}

test('an Answer streams, resumes after a reload, and stops', async ({
  page,
}) => {
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
  // Streamed text means the page is live; Stop pressed before that does nothing.
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toContainText('Mock Answer:')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(answer).toContainText(new RegExp(`${model} [\\d.]+ · ${level}`))
})

test('a new Thread gets its title, then is renamed, pinned and deleted', async ({
  page,
}) => {
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

/** Sends the Prompt and stops its Answer. */
async function sendAndStop(page: Page, text: string) {
  await page.getByLabel('Message').fill(text)
  await page.getByLabel('Message').press('Enter')
  await expect(page).toHaveURL(/\/chat\/\w+$/)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
}

test('an Answer regenerates with another Model', async ({ page }) => {
  // The dev database remembers earlier runs, so pick something else each time.
  const model = (
    await page.getByRole('button', { name: /^Model: / }).textContent()
  )?.includes('Haiku')
    ? 'Sonnet'
    : 'Haiku'
  await sendAndStop(page, 'Regenerate me')
  const answer = page.getByRole('article', { name: 'Answer' })

  await answer
    .getByRole('button', { name: 'Regenerate with another Model' })
    .click()
  await page.keyboard.type(model.toLowerCase())
  await page.keyboard.press('Enter')

  await expect(page.getByText('1 Message removed')).toBeVisible()
  await expect(answer).toHaveAttribute('aria-busy', 'true')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(answer).toContainText(new RegExp(`${model} [\\d.]+`))
  await expect(page.getByRole('article', { name: 'Prompt' })).toHaveText([
    'Regenerate me',
  ])
})

test('editing a Prompt mid-Thread resends it and drops what followed', async ({
  page,
}) => {
  await sendAndStop(page, 'First')
  await sendAndStop(page, 'Second')
  const first = page.getByRole('article', { name: 'Prompt' }).first()

  await first.hover()
  await first.getByRole('button', { name: 'Edit' }).click()
  await first.getByLabel('Edit Prompt').fill('First, edited')
  await first.getByLabel('Edit Prompt').press('Enter')

  await expect(page.getByText('3 Messages removed')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Prompt' })).toHaveText([
    'First, edited',
  ])
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toHaveAttribute('aria-busy', 'true')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(answer.getByText('Stopped')).toBeVisible()
})

test('a pasted image is sent, shows as a thumbnail, and only its owner can read it', async ({
  page,
  playwright,
}) => {
  const message = page.getByLabel('Message')
  // The composer is hydrated once the Model options load.
  await expect(page.getByRole('button', { name: /^Model: / })).toBeVisible()

  // Pastes a 64×48 PNG, as copying an image would.
  await message.evaluate(async (textarea) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    canvas.getContext('2d')!.fillRect(0, 0, 64, 48)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    const data = new DataTransfer()
    data.items.add(new File([blob!], 'square.png', { type: 'image/png' }))
    textarea.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  // Re-encoded to WebP in the browser.
  await expect(
    page.getByRole('button', { name: 'Remove square.webp' }),
  ).toBeVisible()
  await message.fill('What is this?')
  await message.press('Enter')
  await expect(page).toHaveURL(/\/chat\/\w+$/)
  await page.getByRole('button', { name: 'Stop' }).click()

  const prompt = page.getByRole('article', { name: 'Prompt' })
  const thumbnail = prompt.getByRole('img', { name: 'square.webp' })
  await expect(thumbnail).toBeVisible()
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(64)
  await prompt.getByRole('button', { name: 'Open square.webp' }).click()
  await expect(page.getByRole('dialog', { name: 'square.webp' })).toBeVisible()
  await page.keyboard.press('Escape')

  const url = (await thumbnail.getAttribute('src'))!
  expect(url).toMatch(/^\/api\/attachments\/\w+$/)
  const own = await page.request.get(url)
  expect(own.status()).toBe(200)
  expect(own.headers()['content-type']).toBe('image/webp')

  // Another User, created by the Admin; earlier runs may have made them already.
  const other = { username: 'e2e_other', password: 'e2e-other-password' }
  const origin = { Origin: 'http://localhost:3000' }
  await page.request.post('/api/auth/admin/create-user', {
    headers: origin,
    data: {
      email: 'e2e-other@chatslop.invalid',
      password: other.password,
      name: other.username,
      role: 'user',
      data: { username: other.username },
    },
  })
  const context = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
  })
  expect((await context.get(url)).status()).toBe(401)
  const signIn = await context.post('/api/auth/sign-in/username', {
    headers: origin,
    data: other,
  })
  expect(signIn.ok()).toBe(true)
  expect((await context.get(url)).status()).toBe(404)
  await context.dispose()
})

test('Thread search finds a Message and jumps to it', async ({ page }) => {
  // Unique per run, since the dev database remembers earlier runs.
  const stamp = Date.now()
  const target = `明日の天気予報によると${stamp}日は晴れのち曇りでしょう`
  await sendAndStop(page, target)
  // Pushes the target out of view.
  await sendAndStop(
    page,
    Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'),
  )
  await page.getByRole('link', { name: 'New Chat' }).click()

  // Mid-sentence, and over 16 search terms once bigrammed.
  await page
    .getByRole('searchbox', { name: 'Search Threads' })
    .fill(`天気予報によると${stamp}日は晴れのち曇り`)
  const hit = page
    .getByRole('navigation', { name: 'Threads' })
    .getByRole('link', { name: new RegExp(`${stamp}日は晴れ`) })
    // The title can match too, while it's still the Prompt.
    .last()
  await hit.click()

  await expect(page).toHaveURL(/\/chat\/\w+#\w+$/)
  const jumped = page.locator(':focus').getByRole('article', { name: 'Prompt' })
  await expect(jumped).toHaveText(target)
  await expect(jumped).toBeInViewport()

  // The URL already has the hash, yet clicking the hit again still jumps.
  const prompt = page
    .getByRole('article', { name: 'Prompt' })
    .filter({ hasText: target })
  await prompt.hover()
  await page.mouse.wheel(0, 10_000)
  await expect(prompt).not.toBeInViewport()
  await hit.click()
  await expect(jumped).toHaveText(target)
  await expect(jumped).toBeInViewport()
})
