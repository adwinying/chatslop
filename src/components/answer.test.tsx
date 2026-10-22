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
