/**
 * src/lib/db/pool.ts
 *
 * Singleton mssql connection pool. One pool serves both databases via
 * fully-qualified names —
 *   reads  → db_ptrj.dbo.HR_*         (ESTATE production HR, SELECT-only)
 *   writes → extend_db_ptrj.dbo.EMPLOYEE_* (manual master, audited)
 *
 * The pool is created lazily on first use and reused for the process lifetime.
 */
import sql from 'mssql'
import { config } from '../../config'

/** Lazily-created shared pool promise (module-level singleton). */
let poolPromise: Promise<sql.ConnectionPool> | null = null

/**
 * Returns the shared connection pool, creating it on first call.
 * Connection database is extend_db_ptrj; db_ptrj is addressed cross-DB.
 */
export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: config.dbServer,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbExt,
      connectionTimeout: config.dbConnectTimeoutSec * 1000,
      requestTimeout: config.dbRequestTimeoutMs,
      pool: {
        min: 1,
        max: 10,
        idleTimeoutMillis: 30_000,
      },
      options: {
        encrypt: false, // internal LAN server, no TLS on the SQL endpoint
        trustServerCertificate: true,
        appName: 'employee-master', // visible in SQL Server for traceability
      },
    })
    poolPromise.catch((err) => {
      console.error('[db] pool connect failed:', err)
      poolPromise = null // allow retry on next request
    })
  }
  return poolPromise
}

/** Closes the pool cleanly (used on process shutdown). */
export async function closePool(): Promise<void> {
  if (poolPromise) {
    const pool = await poolPromise.catch(() => null)
    poolPromise = null
    if (pool) await pool.close().catch(() => {})
  }
}

/**
 * Hard lock: every statement touching db_ptrj must be a bare SELECT.
 * Throws when anything else slips through (defense in depth next to
 * config.estateReadOnly — the DB policy forbids writes to db_ptrj).
 */
export function assertSelectOnly(sqlText: string): void {
  const trimmed = sqlText.trim().replace(/^﻿/, '')
  if (!/^select\b/i.test(trimmed)) {
    throw new Error('db_ptrj access must be SELECT-only')
  }
  if (/;\s*\S/.test(trimmed.replace(/;$/, ''))) {
    throw new Error('multiple statements are not allowed')
  }
}
