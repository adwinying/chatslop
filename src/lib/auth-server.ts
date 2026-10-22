import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'
import { CONVEX_ORIGIN } from '~/lib/convex-origin'

export const { handler, getToken } = convexBetterAuthReactStart({
  convexUrl: CONVEX_ORIGIN,
  // The backend also serves HTTP actions under `/http` on its main port.
  convexSiteUrl: `${CONVEX_ORIGIN}/http`,
})
