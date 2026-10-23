import type { Id } from '@/convex/_generated/dataModel'
import { APICallError } from 'ai'
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
/** Set to make the Provider refuse the next request. */
const refusal = vi.hoisted(() => ({ error: undefined as unknown }))

// A Model whose stream drops mid-Answer, like a lost connection.
vi.mock('@/convex/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/convex/llm')>()),
  modelCall: () => ({
    model: new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        if (refusal.error) throw refusal.error
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
  refusal.error = undefined
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

/** A Thread with gpt-6.1-sol cut to a 900-token budget: (1100 − 100) × 0.9. */
async function smallWindow() {
  const t = setup()
  await syncModels(t)
  const { as } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  await t.run((ctx) =>
    ctx.db.patch('models', modelId, { contextLimit: 1100, outputLimit: 100 }),
  )
  const send = (text: string, threadId?: Id<'threads'>) =>
    as.mutation(api.threads.send, { threadId, text, modelId, webSearch: false })
  const run = async (threadId: Id<'threads'>) =>
    await t.action(internal.answer.run, {
      liveAnswerId: (await as.query(api.liveAnswers.get, { threadId }))!._id,
    })
  const messages = async (threadId: Id<'threads'>) =>
    (await as.query(api.threads.messages, { threadId }))!
  return { t, as, send, run, messages }
}

const tokens = (n: number) => 'x'.repeat(n * 4)

test('drops the oldest pairs that overflow the Model and marks where the Context starts', async () => {
  const { t, as, send, run, messages } = await smallWindow()
  const threadId = await send(tokens(500))
  await t.mutation(internal.liveAnswers.finish, {
    liveAnswerId: (await as.query(api.liveAnswers.get, { threadId }))!._id,
    parts: [{ type: 'text', text: 'One', state: 'done' }],
  })
  await send(tokens(500), threadId)

  await run(threadId)

  expect(requests.at(-1)).toEqual([{ role: 'user', text: tokens(500) }])
  const [, , second, answer] = await messages(threadId)
  expect(answer).toMatchObject({ contextStartMessageId: second!._id })
})

test('a Prompt too long for the Model errors without a Provider call', async () => {
  const { send, run, messages } = await smallWindow()
  const threadId = await send(tokens(1000))
  const sent = requests.length

  await run(threadId)

  expect(requests).toHaveLength(sent)
  expect((await messages(threadId)).at(-1)).toMatchObject({
    status: 'error',
    error: 'Prompt too long for this Model',
  })
})

test('a Provider rejecting the Thread as too long errors the Answer', async () => {
  const { send, run, messages } = await smallWindow()
  const threadId = await send('Hi')
  refusal.error = new APICallError({
    message: 'prompt is too long: 250000 tokens > 200000 maximum',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: 400,
  })

  await run(threadId)

  const answer = (await messages(threadId)).at(-1)
  expect(answer).toMatchObject({
    status: 'error',
    error: 'Thread too long for this Model',
  })
  expect(answer).not.toHaveProperty('contextStartMessageId')
})
