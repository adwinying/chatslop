import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import { modelOf, setup, signInAdmin, syncModels } from '@/convex/test.setup'

// A Model whose stream drops mid-Answer, like a lost connection.
vi.mock('@/convex/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/convex/llm')>()),
  modelCall: () => ({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 't' })
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'Half' })
            controller.error(new Error('socket disconnected'))
          },
        }),
      }),
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
  const threadId = await as.mutation(api.threads.send, { text: 'Hi', modelId })
  const live = await as.query(api.liveAnswers.get, { threadId })

  await t.action(internal.answer.run, { liveAnswerId: live!._id })

  const answer = (await as.query(api.threads.messages, { threadId }))!.at(-1)
  expect(answer).toMatchObject({
    role: 'assistant',
    status: 'error',
    error: 'socket disconnected',
  })
})
