/**
 * src/index.ts — Employee Master (HRD) entry point (Bun.serve).
 *
 * Data rules:
 *   - reads  → db_ptrj        (HR_* production tables, SELECT-only)
 *   - writes → extend_db_ptrj (EMPLOYEE_MASTER / EMPLOYEE_CHANGES, audited)
 */
import { createApp } from './server'
import { createRequestHandler, type LoopbackCheck } from './http/requestHandler'
import { config } from './config'
import { closePool } from './lib/db/pool'

const app = createApp()

/** Peer-address check bound to the live server handle (lazy: set after serve). */
let serverRef: { requestIP(req: Request): { address: string } | null } | undefined
const isLoopback: LoopbackCheck = (req) => {
  try {
    const peer = serverRef?.requestIP(req)?.address ?? ''
    return peer === '127.0.0.1' || peer === '::1'
  } catch {
    return false
  }
}

const handle = createRequestHandler(app, undefined, isLoopback)

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: (req) => handle(req),
  // Graceful-ish shutdown for hot-reload / port-healer restarts.
  error(err) {
    console.error('[server]', err)
    return new Response('Internal Server Error', { status: 500 })
  },
})
serverRef = server

console.log(
  `employee-master listening on http://${config.host}:${config.port} (mount ${process.env.EMP_BASE_PATH || '/employee-master'})`,
)
console.log(`  manual  → ${config.dbExt}.dbo.EMPLOYEE_MASTER (read/write)`)
console.log(`  sistem  → ${config.dbEstate}.dbo.HR_* (SELECT-only)`)

/** Close the SQL pool on shutdown (SIGINT/SIGTERM + Bun hot reload teardown). */
async function shutdown(): Promise<void> {
  await closePool()
  server.stop(true)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
