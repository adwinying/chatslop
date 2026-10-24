import { useEffect, useEffectEvent } from 'react'

/**
 * Calls `run` when Mod (⌘ or Ctrl) plus `key` is pressed anywhere on the
 * page, and returns the combination for the target's `aria-keyshortcuts`.
 */
export function useShortcut(
  key: Lowercase<string>,
  run: () => void,
  { shift = false } = {},
) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.shiftKey !== shift ||
      letter(event) !== key ||
      // keyCode 229: Safari's key after composition ends, as in the composer.
      event.isComposing ||
      event.keyCode === 229 ||
      // Dialogs, modal or not, own their keys.
      (event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="alertdialog"]'))
    )
      return
    event.preventDefault()
    run()
  })

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const keys = `${shift ? 'Shift+' : ''}${key.toUpperCase()}`
  return `Meta+${keys} Control+${keys}`
}

/** The Latin letter pressed, read from the key's position on non-Latin layouts. */
function letter(event: KeyboardEvent) {
  return /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : event.code.replace(/^Key/, '').toLowerCase()
}
