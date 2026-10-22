import { createIsomorphicFn } from '@tanstack/react-start'

/** Convex stays on loopback; browsers reach it through the `/convex` proxy (ADR 0001). */
export const CONVEX_ORIGIN = 'http://127.0.0.1:3210'

export const convexUrl = createIsomorphicFn()
  .server(() => CONVEX_ORIGIN)
  .client(() => `${location.origin}/convex`)
