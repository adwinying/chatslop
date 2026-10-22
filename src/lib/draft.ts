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
 * Where a User's Draft for a Thread, or for a new Thread without a
 * `threadId`, is kept. Per User, as Users can share a browser.
 */
export const draftKey = (userId: string, threadId?: string) =>
  `draft:${userId}:${threadId ?? 'new'}`

/**
 * The Draft text under `key`, empty and unwritable until the key is known. It
 * lives in localStorage, so it survives reloads; the server renders it empty.
 */
export function useDraft(key: string | undefined) {
  const read = () => (key && localStorage.getItem(key)) ?? ''
  const text = useSyncExternalStore(subscribe, read, () => '')

  const setText = (action: SetStateAction<string>) => {
    if (!key) return
    const next = typeof action === 'function' ? action(read()) : action
    if (next) localStorage.setItem(key, next)
    else localStorage.removeItem(key)
    for (const listener of listeners) listener()
  }
  return [text, setText] as const
}
