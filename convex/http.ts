import { httpRouter } from 'convex/server'
import { SERVE_PREFIX, serve } from '@/convex/attachments'
import { authComponent, createAuth } from '@/convex/auth'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)
http.route({ pathPrefix: SERVE_PREFIX, method: 'GET', handler: serve })

export default http
