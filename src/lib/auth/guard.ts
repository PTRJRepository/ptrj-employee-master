/* =====================================================================
 * src/lib/auth/guard.ts
 * -----------------------------------------------------------------------------
 * Monorepo SSO guard for the Employee Master (HRD) module.
 *
 * Identity resolution order:
 *   1. Portal RS256 cookie (`auth-token`) — verified against the repo-root
 *      keys/public.pem via the copied authkit. Cannot be spoofed.
 *   2. Gateway-injected X-User-* headers — accepted ONLY from loopback
 *      peers. The gateway (:3001) verifies the cookie, strips inbound header
 *      copies, then injects the verified identity. This service binds
 *      0.0.0.0 (LAN-reachable), so a raw caller could forge these headers;
 *      loopback-only acceptance is the anti-spoof fence.
 *
 * Access policy (HRD portal, 2026-09):
 *   - enter : every portal role in ALLOWED_ROLES (view data, live polling)
 *   - edit  : every allowed role EXCEPT `visitor` (create/update rows)
 *   - delete: admin / superadmin / hrd only
 * =====================================================================
 */
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveIdentity, hasRole } from '../authkit/index.js'

/** URL prefix this module is mounted under (gateway path AND direct port). */
export const MODULE_PREFIX = process.env.EMP_BASE_PATH || '/employee-master'

/**
 * Repo root = four levels above this folder
 * (src/lib/auth → src → employee-master → Module Services → repo root).
 */
const MODULE_ROOT = resolve(import.meta.dir, '..', '..', '..', '..')
const REPO_ROOT = resolve(MODULE_ROOT, '..')
/** Keys directory holding the portal RSA keypair; undefined → authkit walks up from cwd. */
export const KEYS_DIR: string | undefined = existsSync(join(REPO_ROOT, 'keys', 'public.pem'))
  ? join(REPO_ROOT, 'keys')
  : undefined

/** Roles that may enter the module (view). Mirrors the portal role list. */
export const ALLOWED_ROLES: readonly string[] = [
  'admin',
  'superadmin',
  'hrd',
  'kerani',
  'akunting',
  'accounting',
  'pajak',
  'mngr',
  'asisten',
  'mandor',
  'visitor',
  'gm_estate',
]

/** Roles allowed to create/update employee rows (everyone but visitors). */
const EDIT_DENY_ROLES: readonly string[] = ['visitor']

/** Roles allowed to delete employee rows. */
const DELETE_ROLES: readonly string[] = ['admin', 'superadmin', 'hrd']

/** Bolehkah sesi ini memakai modul (role dikenal portal)? */
export function canEnter(user: { role?: string } | null | undefined): boolean {
  return !!user && hasRole(user as never, ...ALLOWED_ROLES)
}

/** Bolehkah sesi ini menulis (create/update)? */
export function canEdit(user: Identity | null): boolean {
  if (!user) return false
  if (!canEnter(user)) return false
  return !hasRole(user as never, ...EDIT_DENY_ROLES)
}

/** Bolehkah sesi ini menghapus baris karyawan? */
export function canDelete(user: Identity | null): boolean {
  return !!user && hasRole(user as never, ...DELETE_ROLES)
}

/** Minimal authenticated-user shape passed around handlers. */
export interface Identity {
  userId: number | string
  name: string
  email: string
  role: string
  source?: string
}

/** Paths reachable WITHOUT any session (deliberately tiny). */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/api/health',      // connectivity probe — no sensitive payload
  '/api/auth/login',  // the sign-in endpoint itself
  '/api/auth/logout', // clearing the session
  '/api/auth/me',     // answers 401 JSON (not a redirect) when anonymous
])

/** True when the (prefix-stripped) request path needs no authentication. */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || path === '/login'
}

/** Minimal structural view of Bun.Server used for peer-address checks. */
export interface PeerServer {
  requestIP(req: Request): { address: string } | null
}

/**
 * True when the request arrived over loopback (127.0.0.1 / ::1) — the only
 * case where gateway-injected X-User-* headers are trusted.
 */
export function loopbackOf(req: Request, server?: PeerServer): boolean {
  try {
    const peer = server?.requestIP(req)?.address ?? ''
    return peer === '127.0.0.1' || peer === '::1'
  } catch {
    return false
  }
}

/**
 * Resolve the caller's identity: portal cookie first (RS256), then gateway
 * X-User-* headers — but only when the TCP peer is loopback (the local
 * gateway), never a raw LAN client.
 *
 * `isLoopback` is computed once per request by the request handler (it owns
 * the Bun.Server handle); pass `true` only for 127.0.0.1 / ::1 peers.
 */
export function getIdentity(req: Request, isLoopback: boolean): Identity | null {
  const cookie = req.headers.get('cookie') ?? ''
  const fromCookie = resolveIdentity({ cookie, opts: { keysDir: KEYS_DIR } })
  if (fromCookie) return fromCookie as Identity
  if (!isLoopback) return null
  const headers = Object.fromEntries(req.headers.entries())
  if (!headers['x-user-id']) return null
  return (resolveIdentity({ headers }) as Identity | null)
}
