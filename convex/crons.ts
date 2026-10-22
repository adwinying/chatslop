import { cronJobs } from 'convex/server'
import { internal } from '@/convex/_generated/api'

const crons = cronJobs()

crons.interval(
  'sync Models from models.dev',
  { hours: 24 },
  internal.modelSync.sync,
  {},
)

export default crons
