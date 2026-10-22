import type { DataModel } from '@/convex/_generated/dataModel'
import type { GenericCtx } from '@convex-dev/better-auth'
import { createAuth } from '@/convex/auth'

// Static instance for `auth generate` only. Never import it at runtime.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the CLI only reads the options.
export const auth = createAuth({} as GenericCtx<DataModel>)
