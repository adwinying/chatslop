import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Composer } from '~/components/composer'

function renderComposer(streaming = false) {
  const onSend = vi.fn<(text: string) => Promise<unknown>>(async () => {})
  const onStop = vi.fn<() => void>()
  render(<Composer streaming={streaming} onSend={onSend} onStop={onStop} />)
  const textarea = screen.getByLabelText('Message')
  fireEvent.change(textarea, { target: { value: 'Hello' } })
  return { onSend, onStop, textarea }
}

afterEach(cleanup)

describe('Composer', () => {
  test('Enter sends and clears the text', async () => {
    const { onSend, textarea } = renderComposer()

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('Hello')
    await vi.waitFor(() => expect(textarea).toHaveProperty('value', ''))
  })

  test('Shift+Enter adds a newline instead', () => {
    const { onSend, textarea } = renderComposer()

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  test('Enter during IME composition does not send', () => {
    const { onSend, textarea } = renderComposer()

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    // Safari ends composition before the confirming keydown, flagged by 229.
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 })

    expect(onSend).not.toHaveBeenCalled()
  })

  test('shows Stop instead of Send while the Answer streams', () => {
    const { onSend, onStop, textarea } = renderComposer(true)

    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(onSend).not.toHaveBeenCalled()
    expect(onStop).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })
})
