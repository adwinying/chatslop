import { createIsomorphicFn } from '@tanstack/react-start'
import { CONVEX_ORIGIN } from '~/lib/convex-origin'

export const convexUrl = createIsomorphicFn()
  .server(() => CONVEX_ORIGIN)
  .client(() => `${location.origin}/convex`)
