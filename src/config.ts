/**
 * src/config.ts
 * -----------------------------------------------------------------------------
 * Central runtime configuration for the Employee Master (HRD) portal.
 *
 * - Loads environment variables once (from `.env` via Bun) and freezes them.
 * - This is the ONLY file that knows connection strings and access-policy flags.
 * - Access policy:
 *     READ  -> db_ptrj         (ESTATE, strict SELECT-only — production HR data)
 *     WRITE -> extend_db_ptrj  (EMPLOYEE_MASTER / EMPLOYEE_CHANGES only)
 *     NEVER -> db_ptrj_mill    (PABRIK/MILL, out of scope)
 */
import { join } from 'node:path'

/** Parsed integer env helper with fallback. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Parsed boolean env helper ("true"/"1" = true). */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw === 'true' || raw === '1'
}

/** Application configuration shape. */
export interface AppConfig {
  /** HTTP port for the Bun server. */
  port: number
  /** Bind host for the Bun server. */
  host: string
  /** Frontend build dir (web/dist) served by the backend. */
  uiDir: string
  /** SQL Server host. */
  dbServer: string
  /** SQL Server TCP port. */
  dbPort: number
  /** SQL login user. */
  dbUser: string
  /** SQL login password (never logged). */
  dbPassword: string
  /** Connection timeout in seconds. */
  dbConnectTimeoutSec: number
  /** Per-request timeout in milliseconds. */
  dbRequestTimeoutMs: number
  /** ESTATE database — READ-ONLY (db_ptrj.HR_*). */
  dbEstate: string
  /** Extension database — READ/WRITE (EMPLOYEE_MASTER / EMPLOYEE_CHANGES). */
  dbExt: string
  /** Hard lock: estate statements must be SELECT-only. */
  estateReadOnly: boolean
}

/** Resolved, frozen application configuration. */
export const config: AppConfig = Object.freeze({
  port: intEnv('PORT', 8018),
  host: process.env.HOST || '0.0.0.0',
  uiDir: process.env.EMP_UI_DIR || join(import.meta.dir, '..', 'web', 'dist'),
  dbServer: process.env.DB_SERVER || '10.0.0.110',
  dbPort: intEnv('DB_PORT', 1433),
  dbUser: process.env.DB_USER || 'sa',
  dbPassword: process.env.DB_PASSWORD || '',
  dbConnectTimeoutSec: intEnv('DB_CONNECTION_TIMEOUT', 15),
  dbRequestTimeoutMs: intEnv('DB_REQUEST_TIMEOUT', 30000),
  dbEstate: process.env.DB_ESTATE || 'db_ptrj',
  dbExt: process.env.DB_EMP_EXT || 'extend_db_ptrj',
  estateReadOnly: boolEnv('ESTATE_READ_ONLY', true),
})
