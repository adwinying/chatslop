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
  attachments: { name: string; mediaType: string; size: number }[],
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

const bytes = (text: string) => new TextEncoder().encode(text)
const load = async ({ name }: { name: string }) =>
  name.startsWith('gone') ? null : bytes(`contents of ${name}`)

test('sends readable files as base64 data and inlines text files', async () => {
  const messages = await contextMessages(
    [
      prompt('Look', [
        { name: 'cat.webp', mediaType: 'image/webp', size: 10 },
        { name: 'paper.pdf', mediaType: 'application/pdf', size: 10 },
        { name: 'notes.ts', mediaType: 'text/plain', size: 10 },
      ]),
      answer('Nice.'),
    ],
    ['image', 'pdf'],
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
  const [message] = await contextMessages(
    [
      prompt('', [
        { name: 'cat.webp', mediaType: 'image/webp', size: 10 },
        { name: 'paper.pdf', mediaType: 'application/pdf', size: 10 },
        { name: 'gone.txt', mediaType: 'text/plain', size: 10 },
      ]),
    ],
    ['image'],
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
  const [message] = await contextMessages(
    [
      prompt('Hi', [
        { name: 'binary.txt', mediaType: 'text/plain', size: 3 },
        { name: 'latin1.txt', mediaType: 'text/plain', size: 1 },
      ]),
    ],
    [],
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
  const messages = await contextMessages(
    [
      // Unreadable, so it neither counts nor saves the next one.
      prompt('0', [
        { name: 'huge.webp', mediaType: 'image/webp', size: 30 * MB },
      ]),
      prompt('1', [pdf('first.pdf')]),
      prompt('2', [pdf('second.pdf'), pdf('third.pdf')]),
    ],
    ['pdf'],
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
