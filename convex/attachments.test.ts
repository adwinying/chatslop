import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import { SWEEP_BATCH } from '@/convex/attachments'
import {
  modelOf,
  setup,
  signInAdmin,
  signInUser,
  syncModels,
  type Test,
} from '@/convex/test.setup'

const MB = 1024 * 1024
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PDF header padded to `size` bytes. */
function pdf(size: number) {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode('%PDF-1.7'))
  return bytes
}

// Keeps scheduled functions, like the Answer's action, from running.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const store = (t: Test, bytes: BlobPart) =>
  t.run((ctx) => ctx.storage.store(new Blob([bytes])))

const blobCount = (t: Test) =>
  t.run(async (ctx) => (await ctx.db.system.query('_storage').take(100)).length)

async function signedIn() {
  const t = setup()
  await syncModels(t)
  const { as } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  const add = async (name: string, bytes: BlobPart) =>
    await as.action(api.attachments.add, {
      storageId: await store(t, bytes),
      name,
    })
  return { t, as, modelId, add }
}

describe('attachments.add', () => {
  test('types an upload by its bytes, whatever its name', async () => {
    const { add } = await signedIn()

    expect(await add('photo.txt', new Uint8Array(PNG))).toMatchObject({
      name: 'photo.txt',
      mediaType: 'image/png',
      size: 8,
    })
    expect(await add('paper', pdf(8))).toMatchObject({
      mediaType: 'application/pdf',
    })
    expect(await add('main.rs', 'fn main() {}')).toMatchObject({
      mediaType: 'text/plain',
      size: 12,
    })
  })

  test('refuses other files and oversized ones, deleting their blobs', async () => {
    const { t, add } = await signedIn()

    await expect(add('a.bin', new Uint8Array([97, 0, 98]))).rejects.toThrow(
      'Only images, PDFs and text files can be attached',
    )
    await expect(add('big.pdf', pdf(10 * MB + 1))).rejects.toThrow(
      'big.pdf is over 10 MB',
    )
    await expect(add('big.txt', 'a'.repeat(256 * 1024 + 1))).rejects.toThrow(
      'big.txt is over 256 KB',
    )
    expect(await blobCount(t)).toBe(0)
  })

  test('refuses a blob already registered, keeping it for its owner', async () => {
    const { t, as, add } = await signedIn()
    const notes = await add('notes.md', '# Notes')
    const { storageId } = (await t.run((ctx) =>
      ctx.db.get('attachments', notes._id),
    ))!
    const other = await signInUser(t)

    await expect(
      other.as.action(api.attachments.add, { storageId, name: 'stolen.md' }),
    ).rejects.toThrow('The upload was lost. Attach it again.')
    expect(await (await as.fetch(`/attachments/${notes._id}`)).text()).toBe(
      '# Notes',
    )
  })
})

describe('threads.send with Attachments', () => {
  test('sends an Attachment-only Prompt, with filenames for search and the title', async () => {
    const { t, as, modelId, add } = await signedIn()
    const image = await add('cat.png', new Uint8Array(PNG))
    const notes = await add('notes.md', '# Notes')

    const threadId = await as.mutation(api.threads.send, {
      text: ' ',
      attachmentIds: [image._id, notes._id],
      modelId,
      webSearch: false,
    })

    const [prompt] = (await as.query(api.threads.messages, { threadId }))!
    expect(prompt).toMatchObject({
      parts: [],
      searchText: 'cat.png\nnotes.md',
      attachments: [image, notes],
    })
    expect(prompt).not.toHaveProperty('attachments.0.storageId')
    expect(await t.run((ctx) => ctx.db.get('threads', threadId))).toMatchObject(
      { title: 'File: notes.md' },
    )
  })

  test('titles a Prompt of images alone as attached images', async () => {
    const { t, as, modelId, add } = await signedIn()
    const image = await add('cat.png', new Uint8Array(PNG))

    const threadId = await as.mutation(api.threads.send, {
      text: '',
      attachmentIds: [image._id],
      modelId,
      webSearch: false,
    })

    expect(await t.run((ctx) => ctx.db.get('threads', threadId))).toMatchObject(
      { title: 'Attached image' },
    )
  })

  test('refuses over 10 Attachments, ones the Model cannot read, and sent ones', async () => {
    const { t, as, add } = await signedIn()
    const haiku = await modelOf(t, 'claude-haiku-5-5')
    const send = (attachmentIds: Id<'attachments'>[]) =>
      as.mutation(api.threads.send, {
        text: 'Hi',
        attachmentIds,
        modelId: haiku._id,
        webSearch: false,
      })
    const texts = await Promise.all(
      Array.from({ length: 11 }, (_, i) => add(`${i}.txt`, `${i}`)),
    )
    const paper = await add('paper.pdf', pdf(8))

    await expect(send(texts.map((a) => a._id))).rejects.toThrow(
      'Attach at most 10 files',
    )
    await expect(send([paper._id])).rejects.toThrow(
      "This Model can't read paper.pdf",
    )
    await send([texts[0]!._id])
    await t.run(async (ctx) => {
      const live = await ctx.db.query('liveAnswers').first()
      await ctx.db.delete('liveAnswers', live!._id)
    })
    await expect(send([texts[0]!._id])).rejects.toThrow(
      'An Attachment is gone. Remove it and attach it again.',
    )
  })

  test('an edit keeps the Attachments it lists, adds new ones and deletes the rest', async () => {
    const { t, as, modelId, add } = await signedIn()
    const kept = await add('kept.txt', 'kept')
    const dropped = await add('dropped.txt', 'dropped')
    const threadId = await as.mutation(api.threads.send, {
      text: 'Hi',
      attachmentIds: [kept._id, dropped._id],
      modelId,
      webSearch: false,
    })
    await t.run(async (ctx) => {
      const live = await ctx.db.query('liveAnswers').first()
      await ctx.db.delete('liveAnswers', live!._id)
    })
    const added = await add('added.txt', 'added')
    const [prompt] = (await as.query(api.threads.messages, { threadId }))!

    await as.mutation(api.threads.edit, {
      promptId: prompt!._id,
      text: 'Hi',
      attachmentIds: [kept._id, added._id],
      modelId,
      webSearch: false,
    })

    expect(
      (await as.query(api.threads.messages, { threadId }))![0],
    ).toMatchObject({
      searchText: 'Hi\nkept.txt\nadded.txt',
      attachments: [kept, added],
    })
    expect(await blobCount(t)).toBe(2)
  })

  test('marks an Attachment whose blob is gone as missing in the Context', async () => {
    const { t, as, modelId, add } = await signedIn()
    const kept = await add('kept.txt', 'kept')
    const gone = await add('gone.txt', 'gone')
    await as.mutation(api.threads.send, {
      text: 'Hi',
      attachmentIds: [kept._id, gone._id],
      modelId,
      webSearch: false,
    })
    const liveAnswerId = await t.run(async (ctx) => {
      const { storageId } = (await ctx.db.get('attachments', gone._id))!
      await ctx.storage.delete(storageId)
      return (await ctx.db.query('liveAnswers').first())!._id
    })

    const context = await t.query(internal.liveAnswers.context, {
      liveAnswerId,
    })

    expect(context?.messages[0]?.attachments).toMatchObject([
      { name: 'kept.txt', missing: false },
      { name: 'gone.txt', missing: true },
    ])
  })

  test("refuses another User's Attachment", async () => {
    const { t, as, modelId } = await signedIn()
    const theirs = await t.run(async (ctx) =>
      ctx.db.insert('attachments', {
        userId: 'someone-else',
        storageId: await ctx.storage.store(new Blob(['hi'])),
        name: 'theirs.txt',
        mediaType: 'text/plain',
        size: 2,
      }),
    )

    await expect(
      as.mutation(api.threads.send, {
        text: 'Hi',
        attachmentIds: [theirs],
        modelId,
        webSearch: false,
      }),
    ).rejects.toThrow('An Attachment is gone. Remove it and attach it again.')
  })
})

describe('unsent Attachments', () => {
  test('removing one from the Draft deletes it with its blob, but never a sent one', async () => {
    const { t, as, modelId, add } = await signedIn()
    const sent = await add('sent.txt', 'sent')
    const draft = await add('draft.txt', 'draft')
    await as.mutation(api.threads.send, {
      text: 'Hi',
      attachmentIds: [sent._id],
      modelId,
      webSearch: false,
    })

    await as.mutation(api.attachments.remove, { attachmentId: draft._id })
    await as.mutation(api.attachments.remove, { attachmentId: sent._id })

    expect(await blobCount(t)).toBe(1)
  })

  test('are deleted with their blobs after 24 hours', async () => {
    const { t, as, modelId, add } = await signedIn()
    const sent = await add('sent.txt', 'sent')
    await add('old.txt', 'old')
    await as.mutation(api.threads.send, {
      text: 'Hi',
      attachmentIds: [sent._id],
      modelId,
      webSearch: false,
    })
    vi.advanceTimersByTime(23 * 3_600_000)
    const fresh = await add('fresh.txt', 'fresh')
    vi.advanceTimersByTime(3_600_000 + 1000)

    await t.mutation(internal.attachments.sweep, {})

    expect(
      await t.run((ctx) => ctx.db.query('attachments').take(10)),
    ).toMatchObject([{ _id: sent._id }, { _id: fresh._id }])
    expect(await blobCount(t)).toBe(2)
  })

  test('blobs never registered are deleted after 24 hours, a batch at a time', async () => {
    const { t, add } = await signedIn()
    await add('unsent.txt', 'unsent')
    for (let i = 0; i <= SWEEP_BATCH; i++) await store(t, `lost ${i}`)
    vi.advanceTimersByTime(24 * 3_600_000 + 1000)
    await store(t, 'still uploading')

    await t.mutation(internal.attachments.sweepBlobs, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(await blobCount(t)).toBe(2)
  })
})

describe('GET /attachments/:id', () => {
  test('streams the blob to its owner and to nobody else', async () => {
    const { t, as, add } = await signedIn()
    const notes = await add('notes.md', '# Notes')
    const other = await signInUser(t)

    const res = await as.fetch(`/attachments/${notes._id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    // Another User signing in on the same browser mustn't get it from the cache.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.text()).toBe('# Notes')

    expect((await other.as.fetch(`/attachments/${notes._id}`)).status).toBe(404)
    expect((await as.fetch('/attachments/not-an-id')).status).toBe(404)
    expect((await t.fetch(`/attachments/${notes._id}`)).status).toBe(401)
  })
})
