import { cleanup, render, screen } from '@testing-library/react'
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

test('labels what made the Answer, with usage and timing on hover', () => {
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

  const label = screen.getByText('Opus 5.5 · high')
  expect(label.title).toBe('1.2K in · 56 out · first token 0.8s · 4.1s total')
  expect(screen.getByLabelText('Web search')).toBeTruthy()
})
