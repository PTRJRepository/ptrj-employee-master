/**
 * src/server.ts — Elysia API app.
 *
 * The auth gate (src/lib/auth/flow.ts) runs BEFORE these routes in
 * src/http/requestHandler.ts, so every handler here is reached with an
 * authenticated session (except the tiny public paths in guard.ts).
 *
 * Route groups are composed with `.use()` (the documented Elysia plugin
 * pattern — each group owns its own instance so generics stay sane).
 */
import { Elysia } from 'elysia'
import { manualRoutes } from './routes/manual'
import { sistemRoutes } from './routes/sistem'

export function createApp() {
  return new Elysia()
    .get('/api/health', () => ({
      status: 'ok',
      service: 'employee-master',
      runtime: `bun ${Bun.version}`,
    }))
    .use(manualRoutes())
    .use(sistemRoutes())
}
