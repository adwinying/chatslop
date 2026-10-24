import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useShortcut } from '~/lib/shortcut'

afterEach(cleanup)

function listen() {
  const run = vi.fn<() => void>()
  renderHook(() => useShortcut('k', run))
  return run
}

test('runs on ⌘K and Ctrl+K, not on AltGr or Shift', () => {
  const run = listen()

  fireEvent.keyDown(document, { key: 'k', metaKey: true })
  fireEvent.keyDown(document, { key: 'K', ctrlKey: true })
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true, altKey: true })
  fireEvent.keyDown(document, { key: 'K', ctrlKey: true, shiftKey: true })

  expect(run).toHaveBeenCalledTimes(2)
})

test('runs on the K key of a non-Latin layout', () => {
  const run = listen()

  fireEvent.keyDown(document, { key: 'л', code: 'KeyK', ctrlKey: true })

  expect(run).toHaveBeenCalledOnce()
})

test('leaves IME composition alone', () => {
  const run = listen()

  fireEvent.keyDown(document, { key: 'k', ctrlKey: true, isComposing: true })
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true, keyCode: 229 })

  expect(run).not.toHaveBeenCalled()
})

test('leaves keys inside a dialog to the dialog', () => {
  const run = listen()
  const dialog = document.body.appendChild(document.createElement('div'))
  dialog.setAttribute('role', 'alertdialog')

  const event = fireEvent.keyDown(dialog, { key: 'k', ctrlKey: true })

  expect(run).not.toHaveBeenCalled()
  expect(event).toBe(true) // Not prevented.
  dialog.remove()
})
