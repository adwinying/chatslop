import { cronJobs } from 'convex/server'
import { internal } from '@/convex/_generated/api'

const crons = cronJobs()

crons.interval(
  'sync Models from models.dev',
  { hours: 24 },
  internal.modelSync.sync,
  {},
)

crons.interval(
  'delete Attachments left unsent for 24 hours',
  { hours: 1 },
  internal.attachments.sweep,
  {},
)

export default crons
