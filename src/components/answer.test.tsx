import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Answer, textOf } from '~/components/answer'

afterEach(cleanup)

test('opens Reasoning while the Model thinks again after some text', () => {
  render(
    <Answer
      streaming
      parts={[
        { type: 'text', text: 'Let me search.', state: 'done' },
        { type: 'reasoning', text: 'Comparing results.', state: 'streaming' },
      ]}
    />,
  )

  expect(screen.getByRole('button', { name: 'Thinking…' })).toHaveProperty(
    'ariaExpanded',
    'true',
  )
})

test('labels what made the Answer, with usage and timing on focus or tap', () => {
  render(
    <Answer
      parts={[{ type: 'text', text: 'Hi.', state: 'done' }]}
      status="complete"
      made={{
        modelName: 'Opus 5.5',
        reasoningLevel: 'high',
        webSearch: true,
        usage: { inputTokens: 1234, outputTokens: 56 },
        timing: { firstTokenMs: 800, durationMs: 4100 },
      }}
    />,
  )

  const label = screen.getByRole('button', {
    name: 'Opus 5.5 · high · Web search',
    description: '1.2K in · 56 out · first token 0.8s · 4.1s total',
  })
  fireEvent.click(label)
  expect(label).toHaveProperty('ariaExpanded', 'true')
})

test('fades in new text, but not text already there when it mounts', () => {
  const parts = [
    {
      type: 'text' as const,
      text: 'Hello there `code`',
      state: 'streaming' as const,
    },
  ]
  const fresh = render(<Answer streaming parts={[]} />)
  fresh.rerender(<Answer streaming parts={parts} />)
  expect(fresh.container.querySelector('[data-sd-animate]')).not.toBeNull()
  expect(fresh.container.querySelector('code')).toHaveProperty(
    'dataset.sdAnimate',
    'true',
  )
  cleanup()

  // Like a reload mid-Answer.
  const reloaded = render(<Answer streaming parts={parts} />)
  expect(reloaded.container.querySelector('[data-sd-animate]')).toBeNull()
})

test('joins text split by citations, and breaks paragraphs at a Web search', () => {
  expect(
    textOf([
      { type: 'step-start' },
      { type: 'text', text: 'Let me search.' },
      { type: 'tool-web_search', toolCallId: 'w', state: 'output-available' },
      { type: 'text', text: 'Use the OTP ' },
      { type: 'text', text: 'sent to your number' },
      { type: 'text', text: '.' },
    ]),
  ).toBe('Let me search.\n\nUse the OTP sent to your number.')
})

const posb = {
  type: 'source',
  sourceType: 'url',
  id: 'posb',
  url: 'https://posb.com.sg/update',
  title: 'POSB',
} as const

test('numbers Anthropic citations after the cited phrase, cited Sources first', () => {
  render(
    <Answer
      parts={[
        { type: 'source-url', sourceId: 'x', url: 'https://x.com/' },
        { type: 'source-url', sourceId: 'p', url: posb.url },
        { type: 'text', text: 'Use the OTP ' },
        {
          type: 'text',
          text: 'sent to your number',
          citations: [{ source: posb, citedText: 'An OTP is sent.' }],
        },
        { type: 'text', text: '.' },
      ]}
    />,
  )

  const source = screen.getByRole('link', { name: 'Source 1: POSB' })
  expect(source.parentElement?.previousElementSibling?.textContent).toBe(
    'sent to your number',
  )
  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent),
  ).toEqual(['1posb.com.sg', 'x.com'])
})

test('swaps the link OpenAI writes for a citation number', () => {
  const link = `([posb.com.sg](${posb.url}))`
  const text = `Use the OTP. ${link} Done.`
  render(
    <Answer
      parts={[
        {
          type: 'text',
          text,
          citations: [
            {
              source: posb,
              startIndex: text.indexOf(link),
              endIndex: text.indexOf(link) + link.length,
            },
          ],
        },
      ]}
    />,
  )

  expect(screen.getByRole('article').querySelector('p')?.textContent).toBe(
    'Use the OTP.1 Done.',
  )
})
