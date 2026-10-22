import type { api } from '@/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { SetStateAction } from 'react'
import { useSyncExternalStore } from 'react'

export type DraftAttachment = FunctionReturnType<typeof api.attachments.add>

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

const parse = (json: string): DraftAttachment[] =>
  json ? JSON.parse(json) : []

/** The Draft's uploaded Attachments under `key`, kept like its text. */
export function useDraftAttachments(key: string | undefined) {
  const [json, setJson] = useDraft(key && `${key}:attachments`)
  const attachments = parse(json)

  const setAttachments = (action: SetStateAction<DraftAttachment[]>) =>
    setJson((current) => {
      const next =
        typeof action === 'function' ? action(parse(current)) : action
      return next.length ? JSON.stringify(next) : ''
    })
  return [attachments, setAttachments] as const
}
