import type { SetStateAction } from 'react'
import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Other tabs editing the same Draft.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/**
 * The Draft text of a Thread, or of a new Thread without a `threadId`. It
 * lives in localStorage, so it survives reloads; the server renders it empty.
 */
export function useDraft(threadId?: string) {
  const key = `draft:${threadId ?? 'new'}`
  const read = () => localStorage.getItem(key) ?? ''
  const text = useSyncExternalStore(subscribe, read, () => '')

  const setText = (action: SetStateAction<string>) => {
    const next = typeof action === 'function' ? action(read()) : action
    if (next) localStorage.setItem(key, next)
    else localStorage.removeItem(key)
    for (const listener of listeners) listener()
  }
  return [text, setText] as const
}
