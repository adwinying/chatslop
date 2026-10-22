import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import { ATTACHMENT_ONLY_TEXT } from '@/convex/context'
import { modelOf, setup, signInAdmin, syncModels } from '@/convex/test.setup'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Each request's Messages, past the system prompt, as role and text. */
const requests = vi.hoisted(() => new Array<{ role: string; text: string }[]>())
/** Each request's last Message as the Model gets it. */
const lastMessages = vi.hoisted(() => new Array<unknown>())

// A Model whose stream drops mid-Answer, like a lost connection.
vi.mock('@/convex/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/convex/llm')>()),
  modelCall: () => ({
    model: new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        lastMessages.push(prompt.at(-1))
        requests.push(
          prompt.flatMap((message) =>
            message.role === 'system'
              ? []
              : [
                  {
                    role: message.role,
                    text: message.content
                      .flatMap((part) =>
                        part.type === 'text' ? [part.text] : [],
                      )
                      .join(''),
                  },
                ],
          ),
        )
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] })
              controller.enqueue({ type: 'text-start', id: 't' })
              controller.enqueue({
                type: 'text-delta',
                id: 't',
                delta: 'Half',
              })
              controller.error(new Error('socket disconnected'))
            },
          }),
        }
      },
    }),
  }),
}))

// Keeps the scheduled run from starting on its own.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('a stream that fails mid-Answer ends it as an error', async () => {
  const t = setup()
  await syncModels(t)
  const { as } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  const threadId = await as.mutation(api.threads.send, {
    text: 'Hi',
    modelId,
    webSearch: true,
  })
  const live = await as.query(api.liveAnswers.get, { threadId })

  await t.action(internal.answer.run, { liveAnswerId: live!._id })

  const answer = (await as.query(api.threads.messages, { threadId }))!.at(-1)
  expect(answer).toMatchObject({
    role: 'assistant',
    status: 'error',
    error: 'socket disconnected',
  })
})

test('errored Answers stay out of later requests; stopped ones stay in', async () => {
  const t = setup()
  await syncModels(t)
  const { as } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  const choices = { modelId, webSearch: false }
  const threadId = await as.mutation(api.threads.send, {
    text: 'Hi',
    ...choices,
  })
  const liveAnswerId = async () =>
    (await as.query(api.liveAnswers.get, { threadId }))!._id

  await t.action(internal.answer.run, { liveAnswerId: await liveAnswerId() })
  await as.mutation(api.threads.send, { threadId, text: 'Again', ...choices })
  await as.mutation(api.threads.stop, { threadId })
  await t.mutation(internal.liveAnswers.finish, {
    liveAnswerId: await liveAnswerId(),
    parts: [{ type: 'text', text: 'Half', state: 'done' }],
  })
  await as.mutation(api.threads.send, { threadId, text: 'Third', ...choices })
  await t.action(internal.answer.run, { liveAnswerId: await liveAnswerId() })

  expect(requests.at(-1)).toEqual([
    { role: 'user', text: 'Hi' },
    { role: 'user', text: 'Again' },
    { role: 'assistant', text: 'Half' },
    { role: 'user', text: 'Third' },
  ])
})

test("sends Attachments as base64 files, inlined text, or placeholders the Model can't read", async () => {
  const t = setup()
  await syncModels(t)
  const { as } = await signInAdmin(t)
  const sol = await modelOf(t, 'gpt-6.1-sol')
  const haiku = await modelOf(t, 'claude-haiku-5-5')
  const add = async (name: string, bytes: BlobPart) =>
    (
      await as.action(api.attachments.add, {
        storageId: await t.run((ctx) => ctx.storage.store(new Blob([bytes]))),
        name,
      })
    )._id
  const threadId = await as.mutation(api.threads.send, {
    text: '',
    attachmentIds: [
      await add('cat.png', PNG),
      await add('paper.pdf', '%PDF-1.7'),
      await add('notes.md', '# Notes'),
    ],
    modelId: sol._id,
    webSearch: false,
  })
  await t.action(internal.answer.run, {
    liveAnswerId: (await as.query(api.liveAnswers.get, { threadId }))!._id,
  })
  const [, answer] = (await as.query(api.threads.messages, { threadId }))!

  // Claude Haiku reads images but not PDFs.
  await as.mutation(api.threads.regenerate, {
    answerId: answer!._id,
    modelId: haiku._id,
  })
  await t.action(internal.answer.run, {
    liveAnswerId: (await as.query(api.liveAnswers.get, { threadId }))!._id,
  })

  expect(lastMessages.at(-1)).toMatchObject({
    role: 'user',
    content: [
      { type: 'file', mediaType: 'image/png', filename: 'cat.png' },
      {
        type: 'text',
        text: "[pdf: paper.pdf omitted, this Model can't read PDFs]",
      },
      { type: 'text', text: '<file name="notes.md">\n# Notes\n</file>' },
      { type: 'text', text: ATTACHMENT_ONLY_TEXT },
    ],
  })
})
