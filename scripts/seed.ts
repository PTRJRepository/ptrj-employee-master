/**
 * scripts/seed.ts — one-time import of the manual master from
 * "Agustus 2026.xlsx" (16 division sheets, ~7.700 rows) into
 * extend_db_ptrj.dbo.EMPLOYEE_MASTER.
 *
 * Usage:
 *   bun scripts/seed.ts                  # import (aborts if table not empty)
 *   bun scripts/seed.ts --force          # TRUNCATE + reimport
 *   bun scripts/seed.ts --dry-run        # parse + report only, no DB writes
 *   bun scripts/seed.ts --file <path>    # alternate workbook
 *   bun scripts/seed.ts --division 1A    # single sheet
 *
 * Layout rules (verified against the workbook — see docs before changing):
 *  - Header row = first of the first 12 rows containing a `NAMA` cell.
 *  - Merged header cells are forward-filled across their merge span
 *    (rows keep ORIGINAL indices — blankrows must stay true so merge
 *    row numbers align).
 *  - Data rows: col A (`NO`) is numeric and NAMA is non-empty.
 *    Section labels ("MAINTENANCE AGRONOMI") and spacer rows are skipped.
 *  - `LK` / `PR` marker columns (value 1) produce gender LK/PR.
 *  - Second `STATUS` column → status2 (STAFF sheet has two STATUS cols).
 *  - `NAMA ANAK` spans several columns (children spill right until the
 *    next differently-named header) → joined with ", ".
 *  - `TEMPAT TANGGAL LAHIR` is one cell "Place, DD Month YYYY" → split.
 *  - `TANGGAL MASUK KERJA`: value sits under its header, but some sheets
 *    (1A) put it one column LEFT when the header cell is empty → fallback
 *    to headerCol-1 only when that cell parses as a date.
 *  - STAFF col G has transfer/promotion notes with NO header → sheet extra.
 */
import * as XLSX from 'xlsx'
import sql from 'mssql'
import { getPool, closePool } from '../src/lib/db/pool'
import { EMPLOYEE_COLUMNS, DIVISIONS, HEADER_MAP } from '../src/lib/employeeSchema'
import { coerceValue, parseIndonesianDate, type ColumnKind } from '../src/routes/common'

const DEFAULT_FILE = 'C:/Users/nbgmf/OneDrive/Documents/Agustus 2026.xlsx'
const BATCH = 500

/** Sheet-specific columns that carry no header in the workbook. */
const SHEET_EXTRA_HEADERS: Record<string, Record<number, string>> = {
  // STAFF: column G holds mutation/promotion notes with no header cell.
  STAFF: { 7: 'CATATAN' },
  // IB: the STATUS header cell contains only whitespace ("  ").
  IB: { 5: 'STATUS' },
}

/** Normalized HEADER_MAP (whitespace collapsed, uppercased). */
const NORM_MAP: Record<string, string> = {}
for (const [k, v] of Object.entries(HEADER_MAP)) {
  NORM_MAP[k.trim().replace(/\s+/g, ' ').toUpperCase()] = v
}

function normName(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Excel serial (days since 1899-12-30) → JS Date.
 * Plausible window only: serial 20000..60000 = 1954..2064. A bare 4-digit
 * YEAR cell (e.g. "2009" stored as a number) must NOT be read as a serial —
 * serial 2009 = 1905-07-01, which is how one ARE B2 row got a 121-year-old
 * hire date. Bare years and out-of-window numbers return null (counted as
 * unparseable by the caller). */
function serialToDate(n: number): Date | null {
  if (!Number.isFinite(n) || n < 20000 || n > 60000) return null
  const ms = Math.round((n - 25569) * 86400000) // 25569 = days to 1970-01-01
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Coerce any Excel cell into a JS Date for a date-kind column. */
function cellDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof raw === 'number') return serialToDate(raw)
  if (typeof raw === 'string') return parseIndonesianDate(raw)
  return null
}

interface ParsedRow {
  [col: string]: unknown
}

interface SheetReport {
  sheet: string
  headerRow: number
  parsed: number
  skippedNoNama: number
  inserted: number
  droppedHeaders: string[]
  zeroValueCols: string[]
  unparseableDates: number
  errors: string[]
}

/** Salary columns guarded by the Rp100.000 floor. */
// Floor applies ONLY to wage-like columns: tunjangan_masa_kerja is a tenure
// allowance legitimately in the 33k-92k range, so it must stay out of the set.
const MONEY_COLS = new Set(['gaji_pokok', 'gaji_total'])

/** Per-column input length caps (mirrors the DDL sizes). */
const MAX_LEN: Partial<Record<string, number>> = {
  division: 50, sub_divisi: 200, nama: 200, status: 50, status2: 50,
  gender: 4, jabatan: 150, catatan: 4000, tempat_lahir: 200,
  no_ktp: 40, no_kk: 40, no_rekening: 50, no_bpjs_tk: 50,
  bpjs_kesehatan: 100, bpjs_jamsostek: 100, nama_ibu: 300,
  nama_suami_istri: 300, nama_anak: 2000, agama: 50, pendidikan: 100,
  alamat: 1000, domisili: 100,
}

/** Parse one sheet into normalized row objects. */
function parseSheet(wb: XLSX.WorkBook, sheet: string): { rows: ParsedRow[]; report: SheetReport } {
  const ws = wb.Sheets[sheet]
  const report: SheetReport = {
    sheet, headerRow: -1, parsed: 0, skippedNoNama: 0, inserted: 0,
    droppedHeaders: [], zeroValueCols: [], unparseableDates: 0, errors: [],
  }
  if (!ws) {
    report.errors.push('sheet not found')
    return { rows: [], report }
  }

  // blankrows MUST stay true: '!merges' row numbers index the raw grid.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][]
  const merges: XLSX.Range[] = (ws['!merges'] as XLSX.Range[]) ?? []

  // Locate header row.
  let hIdx = -1
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    if ((rows[i] ?? []).some((c) => normName(c) === 'NAMA')) { hIdx = i; break }
  }
  if (hIdx < 0) {
    report.errors.push('header row with NAMA not found — sheet skipped')
    return { rows: [], report }
  }
  report.headerRow = hIdx

  // Forward-fill merged header cells (horizontal and vertical spans).
  const hdr: unknown[] = [...(rows[hIdx] ?? [])]
  for (const m of merges) {
    if (m.s.r <= hIdx && hIdx <= m.e.r && m.e.c > m.s.c) {
      const v = hdr[m.s.c]
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        for (let c = m.s.c; c <= m.e.c; c++) if (hdr[c] == null) hdr[c] = v
      }
    }
  }

  // Column map. First occurrence wins; second STATUS → status2;
  // NAMA ANAK handled as a multi-column span below.
  const colMap: Record<string, number> = {}
  const dropped: string[] = []
  const extras = SHEET_EXTRA_HEADERS[sheet] ?? {}
  for (const [c, rawName] of hdr.entries()) {
    if (rawName == null) continue
    let name = normName(rawName)
    if (extras[c] && !name) name = extras[c]
    if (!name) continue
    if (name === 'LK' || name === 'PR') { colMap[`__${name}`] = c; continue }
    const target = NORM_MAP[name]
    if (!target) { if (!dropped.includes(name)) dropped.push(name); continue }
    if (colMap[target] === undefined) colMap[target] = c
    else if (target === 'status' && colMap.status2 === undefined) colMap.status2 = c
    // other duplicates: first wins (children handled via the ANAK span)
  }
  // STAFF extra (col has no header cell at all — colMap via extras loop above
  // only fires when the header cell exists but is unnamed; apply directly):
  for (const [c, name] of Object.entries(extras)) {
    const target = NORM_MAP[name]
    if (target && colMap[target] === undefined) colMap[target] = Number(c)
  }
  report.droppedHeaders = dropped

  // Sheet-local header names (post-fill) for the NAMA ANAK span.
  const namedAt = (c: number): string => {
    const n = normName(hdr[c])
    return n || (extras[c] ? normName(extras[c]) : '')
  }
  const anakCol = colMap.nama_anak
  let anakCols: number[] = []
  if (anakCol !== undefined) {
    anakCols = [anakCol]
    for (let c = anakCol + 1; c < hdr.length; c++) {
      const n = namedAt(c)
      if (n === '' || n === 'NAMA ANAK') anakCols.push(c)
      else break
    }
  }

  // Data rows.
  const out: ParsedRow[] = []
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const noVal = r[0]
    const namaVal = colMap.nama !== undefined ? r[colMap.nama] : null
    const isData = typeof noVal === 'number' && Number.isFinite(noVal)
    if (!isData) continue
    if (namaVal == null || String(namaVal).trim() === '') { report.skippedNoNama++; continue }
    report.parsed++

    const row: ParsedRow = {}
    for (const [target, c] of Object.entries(colMap)) {
      if (target.startsWith('__')) continue
      let raw = r[c]

      if (target === 'nama_anak' && anakCols.length) {
        const parts = anakCols
          .map((ac) => r[ac])
          .filter((v) => v != null && String(v).trim() !== '')
          .map((v) => String(v).trim())
        raw = parts.length ? parts.join(', ') : null
      }

      if (target === 'tanggal_masuk' && (raw == null || raw === '')) {
        const adj = cellDate(r[c - 1])
        if (adj) raw = adj
      }

      if ((target === 'tanggal_masuk' || target === 'tanggal_lahir') && raw != null && raw !== '') {
        const d = cellDate(raw)
        if (!d) report.unparseableDates++
        raw = d
      }

      const kind = EMPLOYEE_COLUMNS[target] as ColumnKind
      const coerced = coerceValue(kind, raw)
      if (!coerced.ok) {
        if (!report.errors.includes(`invalid ${target} @row ${i}`)) {
          report.errors.push(`invalid ${target} @row ${i} (${JSON.stringify(raw)})`)
        }
        continue
      }
      let value = coerced.value
      if (typeof value === 'string') {
        const cap = MAX_LEN[target]
        if (cap && value.length > cap) value = value.slice(0, cap)
      }
      // Salary sanity floor: a positive value below Rp100.000 is a broken
      // source cell (the "+L190" text cell parsed to 190), not a wage.
      if (MONEY_COLS.has(target) && typeof value === 'number' && value > 0 && value < 100000) {
        report.errors.push(
          `money floor: ${target}=${value} rejected @row ${i} (division ${sheet}) — source cell likely corrupt`,
        )
        value = null
      }
      row[target] = value
    }

    // Gender markers.
    const lk = colMap.__LK !== undefined ? r[colMap.__LK] : null
    const pr = colMap.__PR !== undefined ? r[colMap.__PR] : null
    const truthy = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 0 && v !== '0'
    row.gender = truthy(lk) ? 'LK' : truthy(pr) ? 'PR' : null

    // Split "Place, DD Month YYYY" into tempat_lahir + tanggal_lahir.
    const combined = row.tempat_lahir
    if (typeof combined === 'string' && combined.includes(',')) {
      const cut = combined.lastIndexOf(',')
      const place = combined.slice(0, cut).trim()
      const birth = combined.slice(cut + 1).trim()
      const bd = parseIndonesianDate(birth)
      if (bd) {
        row.tempat_lahir = place || null
        row.tanggal_lahir = bd
      } else {
        row.tempat_lahir = combined.slice(0, 1000)
      }
    } else if (combined instanceof Date) {
      row.tanggal_lahir = combined
      row.tempat_lahir = null
    }

    row.division = sheet
    row.no = Math.round(Number(noVal))
    row.nama = String(row.nama).trim().slice(0, 200)
    out.push(row)
  }

  // Count populated columns from the FINAL rows (after the place/birth split
  // and gender markers — the incremental counter above runs before those).
  const nonNullFinal = new Map<string, number>()
  for (const row of out) {
    for (const [k, v] of Object.entries(row)) {
      if (v !== null && v !== undefined && v !== '') {
        nonNullFinal.set(k, (nonNullFinal.get(k) ?? 0) + 1)
      }
    }
  }
  report.zeroValueCols = Object.keys(EMPLOYEE_COLUMNS).filter(
    (c) => c !== 'division' && c !== 'no' && c !== 'nama' && c !== 'gender' && !nonNullFinal.has(c),
  )
  return { rows: out, report }
}

/** Build a bulk-insert table matching the DDL. */
function buildBulkTable(): sql.Table {
  const t = new sql.Table('EMPLOYEE_MASTER')
  t.columns.add('division', sql.NVarChar(50), { nullable: false })
  t.columns.add('sub_divisi', sql.NVarChar(200), { nullable: true })
  t.columns.add('no', sql.Int, { nullable: true })
  t.columns.add('nama', sql.NVarChar(200), { nullable: false })
  t.columns.add('status', sql.NVarChar(50), { nullable: true })
  t.columns.add('status2', sql.NVarChar(50), { nullable: true })
  t.columns.add('gender', sql.NVarChar(4), { nullable: true })
  t.columns.add('jabatan', sql.NVarChar(150), { nullable: true })
  t.columns.add('catatan', sql.NVarChar(4000), { nullable: true })
  t.columns.add('tanggal_masuk', sql.Date(), { nullable: true })
  t.columns.add('tanggal_lahir', sql.Date(), { nullable: true })
  t.columns.add('tempat_lahir', sql.NVarChar(200), { nullable: true })
  t.columns.add('no_ktp', sql.NVarChar(40), { nullable: true })
  t.columns.add('no_kk', sql.NVarChar(40), { nullable: true })
  t.columns.add('no_rekening', sql.NVarChar(50), { nullable: true })
  t.columns.add('no_bpjs_tk', sql.NVarChar(50), { nullable: true })
  t.columns.add('gaji_pokok', sql.Decimal(18, 2), { nullable: true })
  t.columns.add('tunjangan_masa_kerja', sql.Decimal(18, 2), { nullable: true })
  t.columns.add('gaji_total', sql.Decimal(18, 2), { nullable: true })
  t.columns.add('upah', sql.Decimal(18, 2), { nullable: true })
  t.columns.add('bpjs_kesehatan', sql.NVarChar(100), { nullable: true })
  t.columns.add('bpjs_jamsostek', sql.NVarChar(100), { nullable: true })
  t.columns.add('nama_ibu', sql.NVarChar(300), { nullable: true })
  t.columns.add('nama_suami_istri', sql.NVarChar(300), { nullable: true })
  t.columns.add('nama_anak', sql.NVarChar(2000), { nullable: true })
  t.columns.add('agama', sql.NVarChar(50), { nullable: true })
  t.columns.add('pendidikan', sql.NVarChar(100), { nullable: true })
  t.columns.add('alamat', sql.NVarChar(1000), { nullable: true })
  t.columns.add('domisili', sql.NVarChar(100), { nullable: true })
  t.columns.add('created_by', sql.NVarChar(100), { nullable: true })
  t.columns.add('updated_by', sql.NVarChar(100), { nullable: true })
  return t
}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => args.includes(name)
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const file = opt('--file') ?? DEFAULT_FILE
  const force = flag('--force')
  const dryRun = flag('--dry-run')
  const onlyDivision = opt('--division')

  const sheets = DIVISIONS.filter((s) => !onlyDivision || s === onlyDivision)
  console.log(`reading ${file}`)
  const wb = XLSX.readFile(file, { cellDates: true })

  const allRows: ParsedRow[] = []
  const reports: SheetReport[] = []
  for (const sheet of sheets) {
    const { rows, report } = parseSheet(wb, sheet)
    allRows.push(...rows)
    report.inserted = rows.length
    reports.push(report)
  }

  console.log('\n── Parse report ──────────────────────────────')
  let totalParsed = 0
  for (const r of reports) {
    totalParsed += r.parsed
    const warn = [
      r.errors.length ? `errors=${r.errors.length}` : '',
      r.skippedNoNama ? `skipped(no nama)=${r.skippedNoNama}` : '',
      r.unparseableDates ? `badDates=${r.unparseableDates}` : '',
      r.droppedHeaders.length ? `dropped=[${r.droppedHeaders.join(', ')}]` : '',
      r.zeroValueCols.length ? `emptyCols=[${r.zeroValueCols.join(', ')}]` : '',
    ].filter(Boolean).join('  ')
    console.log(`  ${r.sheet.padEnd(10)} rows=${String(r.parsed).padStart(4)}  ${warn}`)
    for (const e of r.errors.slice(0, 3)) console.log(`      ! ${e}`)
  }
  console.log(`  TOTAL rows=${totalParsed}`)

  if (dryRun) {
    console.log('\ndry-run: no database writes')
    return
  }

  const pool = await getPool()
  const existing = await pool.request().query('SELECT COUNT(*) AS n FROM EMPLOYEE_MASTER')
  const count = Number(existing.recordset[0].n)
  if (count > 0 && !force) {
    console.error(`\nEMPLOYEE_MASTER already has ${count} rows. Re-run with --force to TRUNCATE + reseed.`)
    process.exitCode = 1
    return
  }
  if (count > 0 && force) {
    await pool.request().query('DELETE FROM EMPLOYEE_MASTER; DELETE FROM EMPLOYEE_CHANGES; DBCC CHECKIDENT (\'EMPLOYEE_MASTER\', RESEED, 0);')
    console.log(`\n--force: truncated existing ${count} rows (+ audit trail)`)
  }

  const stamp = `seed:Agustus 2026.xlsx`
  let inserted = 0
  let table = buildBulkTable()
  let pending = 0
  for (const row of allRows) {
    const val = (c: string): string | number | boolean | Date | null => {
      const v = row[c]
      return (v === undefined ? null : v) as string | number | boolean | Date | null
    }
    table.rows.add(
      val('division'), val('sub_divisi'), val('no'), val('nama'),
      val('status'), val('status2'), val('gender'), val('jabatan'), val('catatan'),
      val('tanggal_masuk'), val('tanggal_lahir'), val('tempat_lahir'),
      val('no_ktp'), val('no_kk'), val('no_rekening'), val('no_bpjs_tk'),
      val('gaji_pokok'), val('tunjangan_masa_kerja'), val('gaji_total'), val('upah'),
      val('bpjs_kesehatan'), val('bpjs_jamsostek'),
      val('nama_ibu'), val('nama_suami_istri'), val('nama_anak'),
      val('agama'), val('pendidikan'), val('alamat'), val('domisili'),
      stamp, stamp,
    )
    pending++
    if (pending >= BATCH) {
      await pool.request().bulk(table)
      inserted += pending
      process.stdout.write(`\r  inserting… ${inserted}/${allRows.length}`)
      table = buildBulkTable()
      pending = 0
    }
  }
  if (pending > 0) {
    await pool.request().bulk(table)
    inserted += pending
  }
  console.log(`\n  inserted ${inserted} rows`)

  const check = await pool.request().query('SELECT COUNT(*) AS n FROM EMPLOYEE_MASTER')
  console.log(`  EMPLOYEE_MASTER total: ${check.recordset[0].n}`)
  console.log('seed OK')
}

main()
  .catch((err) => {
    console.error('seed FAILED:', err)
    process.exitCode = 1
  })
  .finally(() => closePool())
