import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Composer } from '~/components/composer'

function renderComposer({
  streaming = false,
  blockReason,
}: { streaming?: boolean; blockReason?: string } = {}) {
  const onSend = vi.fn<(text: string) => Promise<unknown>>(async () => {})
  const onStop = vi.fn<() => void>()
  const composer = (
    <Composer
      threadId="t1"
      streaming={streaming}
      blockReason={blockReason}
      onSend={onSend}
      onStop={onStop}
    />
  )
  const { unmount } = render(composer)
  const textarea = screen.getByLabelText('Message')
  fireEvent.change(textarea, { target: { value: 'Hello' } })
  return { onSend, onStop, textarea, unmount, composer }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

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

  test('keeps a Draft written while Send is pending', async () => {
    const { onSend, textarea } = renderComposer()
    const { promise, resolve } = Promise.withResolvers<void>()
    onSend.mockReturnValue(promise)

    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.change(textarea, { target: { value: 'Next Prompt' } })
    await act(async () => resolve())

    expect(textarea).toHaveProperty('value', 'Next Prompt')
  })

  test('sends once while Send is pending', async () => {
    const { onSend, textarea } = renderComposer()
    const { promise, resolve } = Promise.withResolvers<void>()
    onSend.mockReturnValue(promise)

    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await act(async () => resolve())

    expect(onSend).toHaveBeenCalledOnce()
  })

  test('shows Stop instead of Send while the Answer streams', () => {
    const { onSend, onStop, textarea } = renderComposer({ streaming: true })

    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(onSend).not.toHaveBeenCalled()
    expect(onStop).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  test('says why Send is blocked', () => {
    const { onSend, textarea } = renderComposer({ blockReason: 'No Model' })

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText('No Model')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  test("keeps each Thread's Draft across reloads", () => {
    const { unmount, composer } = renderComposer()
    unmount()

    render(composer)

    expect(screen.getByLabelText('Message')).toHaveProperty('value', 'Hello')
    cleanup()
    render(<Composer {...composer.props} threadId="t2" />)
    expect(screen.getByLabelText('Message')).toHaveProperty('value', '')
  })
})
