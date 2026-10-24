import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Answer } from '~/components/answer'

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
