/**
 * src/routes/common.ts — shared helpers for API handlers.
 */
import sql from 'mssql'
import { getIdentity, type Identity } from '../lib/auth/guard'
import { jsonError } from '../lib/http/json'

/**
 * Verified identity for route handlers. The request handler (which owns the
 * peer check) injects it as a base64 header AFTER the auth gate; the
 * cookie-only fallback covers direct calls. See IDENTITY_HEADER in
 * src/http/requestHandler.ts for the trust model.
 */
export function currentUser(req: Request): Identity | null {
  const raw = req.headers.get('x-emp-identity')
  if (raw) {
    try {
      return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Identity
    } catch {
      /* fall through to cookie */
    }
  }
  return getIdentity(req, false)
}

/** Parse a positive integer query param with fallback + cap. */
export function intParam(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

/** Trimmed string query param ('' when absent). */
export function strParam(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 401/403 JSON shortcuts for handlers. */
export const unauthorized = () => jsonError(401, 'Unauthorized: sesi tidak ditemukan')
export const forbidden = (msg: string) => jsonError(403, msg)

/** Column kinds used by the manual master schema (drives SQL bind types). */
export type ColumnKind = 'string' | 'int' | 'money' | 'date'

/** What mssql `request.input(name, type, value)` accepts as its type arg. */
export type SqlBindType = Parameters<sql.Request['input']>[1]

/**
 * Coerce an untrusted JSON value to the JS type matching `kind`.
 * Returns { ok:false } when the value cannot represent that kind
 * (callers turn this into a 400 — never bind unvalidated input).
 */
export function coerceValue(kind: ColumnKind, raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  switch (kind) {
    case 'string': {
      if (typeof raw === 'object') return { ok: false }
      return { ok: true, value: String(raw).trim().slice(0, 4000) || null }
    }
    case 'int': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
      if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false }
      return { ok: true, value: n }
    }
    case 'money': {
      if (typeof raw === 'string') {
        const digits = raw.replace(/[^\d.-]/g, '')
        // Non-numeric garbage must not silently become a real salary value
        // (the "+L190" Excel cell became Rp190 exactly this way in the seed).
        if (digits === '' || digits === '-' || digits === '.') return { ok: false }
        const n = Number(digits)
        if (!Number.isFinite(n)) return { ok: false }
        return { ok: true, value: n }
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false }
      return { ok: true, value: raw }
    }
    case 'date': {
      if (raw instanceof Date) {
        return Number.isNaN(raw.getTime()) ? { ok: false } : { ok: true, value: raw }
      }
      if (typeof raw !== 'string') return { ok: false }
      const s = raw.trim()
      if (!s) return { ok: true, value: null }
      const d = parseIndonesianDate(s)
      if (!d) return { ok: false }
      return { ok: true, value: d }
    }
  }
}

/** Map a JS value to its mssql bind type for the manual master schema. */
export function sqlTypeFor(kind: ColumnKind): SqlBindType {
  switch (kind) {
    case 'int':
      return sql.Int
    case 'money':
      return sql.Decimal(18, 2)
    case 'date':
      return sql.DateTime2
    default:
      return sql.NVarChar(4000)
  }
}

/**
 * Parse dates as they appear in the Excel source: ISO strings, JS Date
 * strings, or Indonesian month names ("03 Desember 2007", "16 Maret 1996").
 * Returns null when the input is not a recognizable date.
 */
export function parseIndonesianDate(input: string): Date | null {
  const s = input.trim()
  if (!s) return null
  // All branches build UTC-midnight Dates on purpose: the mssql driver
  // serializes parameters with getUTC* (tedious useUTC:true default), so a
  // local-midnight Date would be stored ONE CALENDAR DAY EARLIER in GMT+7.
  // Verified against EMPLOYEE_MASTER before this fix (13.534 dates were -1 day).
  // Bare ISO-like: 2013-09-01 (optionally with time)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
  // d/m/Y or d-m-Y
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])))
  // "03 Desember 2007" / "3 Des 2007" / "10-JULI-2018" (dash + uppercase)
  const months: Record<string, number> = {
    januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
    juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, agu: 7, sep: 8, okt: 9, nov: 10, des: 11,
  }
  const idn = s.match(/^(\d{1,2})[-\s/]([A-Za-z]+)[-\s/](\d{4})$/)
  if (idn) {
    const month = months[idn[2].toLowerCase()]
    if (month === undefined) return null
    return new Date(Date.UTC(Number(idn[3]), month, Number(idn[1])))
  }
  // "03 Desember 2007 pukul…" / trailing text tolerated
  const idnLoose = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (idnLoose) {
    const month = months[idnLoose[2].toLowerCase()]
    if (month === undefined) return null
    return new Date(Date.UTC(Number(idnLoose[3]), month, Number(idnLoose[1])))
  }
  return null
}

