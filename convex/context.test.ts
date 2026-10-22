import { expect, test } from 'vitest'
import {
  ATTACHMENT_ONLY_TEXT,
  contextMessages,
  type ContextMessage,
} from '@/convex/context'

const MB = 1024 * 1024

/** A Prompt with Attachments, each keyed by name to bytes the loader returns. */
const prompt = (
  text: string,
  attachments: ContextMessage['attachments'],
): ContextMessage => ({
  role: 'user',
  parts: text ? [{ type: 'text', text }] : [],
  attachments,
})

const answer = (text: string): ContextMessage => ({
  role: 'assistant',
  parts: [{ type: 'text', text }],
  attachments: [],
})

/** A Model that reads these kinds, with no known limits unless given. */
const model = (
  attachmentTypes: ('image' | 'pdf')[],
  limits = { contextLimit: 0, outputLimit: 0 },
) => ({ attachmentTypes, ...limits })

const bytes = (text: string) => new TextEncoder().encode(text)
const load = async ({ name }: { name: string }) =>
  name.startsWith('gone') ? null : bytes(`contents of ${name}`)

test('sends readable files as base64 data and inlines text files', async () => {
  const { messages } = await contextMessages(
    [
      prompt('Look', [
        { name: 'cat.webp', mediaType: 'image/webp', size: 10 },
        { name: 'paper.pdf', mediaType: 'application/pdf', size: 10 },
        { name: 'notes.ts', mediaType: 'text/plain', size: 10 },
      ]),
      answer('Nice.'),
    ],
    model(['image', 'pdf']),
    load,
  )

  expect(messages).toEqual([
    {
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/webp',
          filename: 'cat.webp',
          url: `data:image/webp;base64,${btoa('contents of cat.webp')}`,
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          filename: 'paper.pdf',
          url: `data:application/pdf;base64,${btoa('contents of paper.pdf')}`,
        },
        {
          type: 'text',
          text: '<file name="notes.ts">\ncontents of notes.ts\n</file>',
        },
        { type: 'text', text: 'Look' },
      ],
    },
    { role: 'assistant', parts: [{ type: 'text', text: 'Nice.' }] },
  ])
})

test('swaps files the Model or the server cannot read for placeholders', async () => {
  const {
    messages: [message],
  } = await contextMessages(
    [
      prompt('', [
        { name: 'cat.webp', mediaType: 'image/webp', size: 10 },
        { name: 'paper.pdf', mediaType: 'application/pdf', size: 10 },
        { name: 'gone.txt', mediaType: 'text/plain', size: 10 },
      ]),
    ],
    model(['image']),
    load,
  )

  expect(message!.parts.slice(1)).toEqual([
    {
      type: 'text',
      text: "[pdf: paper.pdf omitted, this Model can't read PDFs]",
    },
    { type: 'text', text: '[text: gone.txt omitted, it could not be read]' },
    { type: 'text', text: ATTACHMENT_ONLY_TEXT },
  ])
})

test('treats a text file that is not UTF-8 or holds NUL as unreadable', async () => {
  const {
    messages: [message],
  } = await contextMessages(
    [
      prompt('Hi', [
        { name: 'binary.txt', mediaType: 'text/plain', size: 3 },
        { name: 'latin1.txt', mediaType: 'text/plain', size: 1 },
      ]),
    ],
    model([]),
    async ({ name }) =>
      name === 'binary.txt'
        ? new Uint8Array([97, 0, 98])
        : new Uint8Array([0xe9]),
  )

  expect(message!.parts).toEqual([
    { type: 'text', text: '[text: binary.txt omitted, it could not be read]' },
    { type: 'text', text: '[text: latin1.txt omitted, it could not be read]' },
    { type: 'text', text: 'Hi' },
  ])
})

test('swaps the oldest readable files for placeholders until the request fits 20 MB', async () => {
  const loaded: string[] = []
  const pdf = (name: string) => ({
    name,
    mediaType: 'application/pdf',
    // 8 MB once base64 encoded.
    size: 6 * MB,
  })
  const { messages } = await contextMessages(
    [
      // Unreadable, so it neither counts nor saves the next one.
      prompt('0', [
        { name: 'huge.webp', mediaType: 'image/webp', size: 30 * MB },
      ]),
      prompt('1', [pdf('first.pdf')]),
      prompt('2', [pdf('second.pdf'), pdf('third.pdf')]),
    ],
    model(['pdf']),
    async (attachment) => {
      loaded.push(attachment.name)
      return load(attachment)
    },
  )

  expect(messages.map((m) => m.parts[0])).toEqual([
    {
      type: 'text',
      text: "[image: huge.webp omitted, this Model can't read images]",
    },
    {
      type: 'text',
      text: '[pdf: first.pdf omitted to keep the request under 20 MB]',
    },
    expect.objectContaining({ type: 'file', filename: 'second.pdf' }),
  ])
  // Omitted blobs are never read.
  expect(loaded).toEqual(['second.pdf', 'third.pdf'])
})

// (1100 − 100) × 0.9 leaves 900 tokens, at 4 characters each.
const limits = { contextLimit: 1100, outputLimit: 100 }
const tokens = (n: number) => 'x'.repeat(n * 4)
const textOf = (message?: { parts: unknown[] }) =>
  message?.parts.flatMap((p) =>
    typeof p === 'object' && p && 'text' in p ? [p.text] : [],
  )

test('sends the whole Thread when it fits the Model', async () => {
  const { messages, dropped } = await contextMessages(
    [prompt(tokens(400), []), answer(tokens(100)), prompt(tokens(390), [])],
    model([], limits),
    load,
  )

  expect(messages).toHaveLength(3)
  expect(dropped).toBe(0)
})

test('drops the oldest Prompt+Answer pairs until the rest fit', async () => {
  const loaded: string[] = []
  const { messages, dropped } = await contextMessages(
    [
      // Would fit as text, but an image costs a fixed 1,600 tokens.
      prompt('0', [{ name: 'old.webp', mediaType: 'image/webp', size: 10 }]),
      answer(tokens(100)),
      prompt(tokens(300), []),
      answer(tokens(100)),
      prompt(tokens(300), []),
    ],
    model(['image'], limits),
    async (attachment) => {
      loaded.push(attachment.name)
      return load(attachment)
    },
  )

  expect(dropped).toBe(2)
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  expect(textOf(messages[0])).toEqual([tokens(300)])
  // Dropped blobs are never read.
  expect(loaded).toEqual([])
})

test('refuses a Prompt that alone does not fit the Model', async () => {
  await expect(
    contextMessages(
      [prompt('Hi', []), answer('Hello.'), prompt(tokens(901), [])],
      model([], limits),
      load,
    ),
  ).rejects.toThrow('Prompt too long for this Model')
})

test('counts PDFs by size against the budget', async () => {
  await expect(
    contextMessages(
      [
        prompt('Read', [
          // 20 bytes a token.
          { name: 'paper.pdf', mediaType: 'application/pdf', size: 20_000 },
        ]),
      ],
      model(['pdf'], limits),
      load,
    ),
  ).rejects.toThrow('Prompt too long for this Model')
})

test('skips the check when the Model has no known limits', async () => {
  const { messages, dropped } = await contextMessages(
    [prompt(tokens(100_000), []), answer('Hi'), prompt(tokens(100_000), [])],
    model([], { contextLimit: 0, outputLimit: 100 }),
    load,
  )

  expect(messages).toHaveLength(3)
  expect(dropped).toBe(0)
})

test('counts text files by characters, not bytes', async () => {
  // 400 characters, 1,200 bytes.
  const kanji = '漢'.repeat(400)
  const { dropped } = await contextMessages(
    [
      prompt(tokens(790), [
        { name: 'notes.md', mediaType: 'text/plain', size: 1200 },
      ]),
    ],
    model([], limits),
    async () => bytes(kanji),
  )

  expect(dropped).toBe(0)
})

test('swaps missing blobs for placeholders before they count', async () => {
  const loaded: string[] = []
  const {
    messages: [message],
  } = await contextMessages(
    [
      prompt('Read', [
        {
          name: 'paper.pdf',
          mediaType: 'application/pdf',
          size: 20_000,
          missing: true,
        },
      ]),
    ],
    model(['pdf'], limits),
    async (attachment) => {
      loaded.push(attachment.name)
      return load(attachment)
    },
  )

  expect(message!.parts[0]).toEqual({
    type: 'text',
    text: '[pdf: paper.pdf omitted, it could not be read]',
  })
  expect(loaded).toEqual([])
})
