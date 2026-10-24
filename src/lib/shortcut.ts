import { useEffect, useEffectEvent } from 'react'

/** Calls `run` when Mod (⌘ or Ctrl) plus `key` is pressed anywhere on the page. */
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
      event.key.toLowerCase() !== key
    )
      return
    event.preventDefault()
    run()
  })

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
