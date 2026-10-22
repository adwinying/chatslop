import { createApi } from '@convex-dev/better-auth'
import { createAuthOptions } from '@/convex/auth'
import schema from '@/convex/betterAuth/schema'

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, createAuthOptions)
