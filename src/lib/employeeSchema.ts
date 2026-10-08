/**
 * src/lib/employeeSchema.ts — single source of truth for the manual master
 * table (extend_db_ptrj.dbo.EMPLOYEE_MASTER).
 *
 * Used by the CRUD routes (validation/bind types) and by scripts/seed.ts
 * (Excel column → table column mapping) so the two can never drift.
 */
import type { ColumnKind } from '../routes/common'

/** Editable data columns: name → kind. Identity/audit columns excluded. */
export const EMPLOYEE_COLUMNS: Record<string, ColumnKind> = {
  division: 'string',
  sub_divisi: 'string',
  no: 'int',
  nama: 'string',
  status: 'string',
  status2: 'string',
  gender: 'string',
  jabatan: 'string',
  catatan: 'string',
  tanggal_masuk: 'date',
  tanggal_lahir: 'date',
  tempat_lahir: 'string',
  no_ktp: 'string',
  no_kk: 'string',
  no_rekening: 'string',
  no_bpjs_tk: 'string',
  gaji_pokok: 'money',
  tunjangan_masa_kerja: 'money',
  gaji_total: 'money',
  upah: 'money',
  bpjs_kesehatan: 'string',
  bpjs_jamsostek: 'string',
  nama_ibu: 'string',
  nama_suami_istri: 'string',
  nama_anak: 'string',
  agama: 'string',
  pendidikan: 'string',
  alamat: 'string',
  domisili: 'string',
}

/** Columns that make up the SELECT list (stable order for API responses). */
export const EMPLOYEE_FIELDS = Object.keys(EMPLOYEE_COLUMNS)

/** Kinds by column, for coercion in routes and seed. */
export type { ColumnKind }

/** The 16 division sheet names from Agustus 2026.xlsx (source divisions). */
export const DIVISIONS: readonly string[] = [
  'STAFF',
  'MILL',
  '1A',
  'IB',
  'IIA',
  'IIB',
  'DME',
  'ARE A',
  'ARE B1',
  'ARE B2',
  'ARE C-NEW',
  'BLT',
  'INFRA',
  'NURSERY',
  'SATPAM',
  'WORKSHOP',
]

/**
 * Excel header → table column, per sheet. Headers not listed here are
 * dropped (they are duplicates or sheet-specific pivots we do not model).
 *
 * Multi-sheet quirks handled:
 * - STAFF: two STATUS columns (marital + tax-status of spouse) → status/status2
 * - MILL : STATUS MILL/STATUS REVISI → status/status2, UPAH → upah,
 *          KETERANGAN → catatan, KEPESERTAAN BPJS TK → bpjs_jamsostek
 * - IB/IIA/IIB/ARE*: NO REK / NO REKENING / BUKU REK → no_rekening
 * - STAFF: DIVISI column (sub-unit inside the sheet) → sub_divisi
 * - BPJS TK / NO BPJS TK (STAFF) → bpjs_jamsostek / no_bpjs_tk
 */
export const HEADER_MAP: Record<string, string> = {
  'NO': 'no',
  'NAMA': 'nama',
  'STATUS': 'status',
  'STATUS MILL': 'status',
  'STATUS REVISI': 'status2',
  'LK': 'gender', // marker column: 1 → LK (handled in seed)
  'PR': 'gender', // marker column: 1 → PR (handled in seed)
  'JABATAN': 'jabatan',
  'DIVISI': 'sub_divisi',
  'CATATAN': 'catatan',
  'KETERANGAN': 'catatan',
  'TANGGAL MASUK KERJA': 'tanggal_masuk',
  'TEMPAT TANGGAL LAHIR': 'tempat_lahir',
  'NO KTP': 'no_ktp',
  'NO KK': 'no_kk',
  'NO REKENING': 'no_rekening',
  'NO REK': 'no_rekening',
  'BUKU REK': 'no_rekening',
  'NO BPJS TK': 'no_bpjs_tk',
  'GAJI POKOK': 'gaji_pokok',
  'TUNJANGAN MASA KERJA': 'tunjangan_masa_kerja',
  'GAJI POKOK + TUNJANGAN TETAP': 'gaji_total',
  'UPAH': 'upah',
  'BPJS KESEHATAN': 'bpjs_kesehatan',
  'BP JAMSOSTEK': 'bpjs_jamsostek',
  'BPJS': 'bpjs_kesehatan',
  'BPJS               TK': 'bpjs_jamsostek', // STAFF: spaced header "BPJS ... TK"
  'KEPESERTAAN BPJS TK': 'bpjs_jamsostek',
  'NAMA IBU': 'nama_ibu',
  'NAMA ISTRI/ SUAMI': 'nama_suami_istri',
  'NAMA ISTRI': 'nama_suami_istri',
  'NAMA ANAK': 'nama_anak',
  'AGAMA': 'agama',
  'PENDIDIKAN': 'pendidikan',
  'ALAMAT': 'alamat',
  'DOMISILI': 'domisili',
}

/* ── Grid metadata (drives <Sheet> in web/) ─────────────────────────────────
 * EMPLOYEE_COLUMNS above stays the authority for SQL bind types and SELECT
 * order. This block adds presentation metadata and is exposed verbatim by
 * GET /api/schema so the browser no longer hardcodes headers (the previous
 * FIELD_LABELS map in web/src/api.ts) and cannot drift from the server.
 * ────────────────────────────────────────────────────────────────────────── */

/** Column-group keys. These become the clickable tabs in the grid. */
export const COLUMN_GROUPS = {
  IDENTITAS: 'Identitas',
  KEPEGAWAIAN: 'Kepegawaian',
  PENGGAJIAN: 'Penggajian',
  BPJS_BANK: 'BPJS & Bank',
  KELUARGA: 'Keluarga',
  ALAMAT: 'Alamat',
  JEJAK: 'Jejak',
} as const

export type ColumnGroupKey = (typeof COLUMN_GROUPS)[keyof typeof COLUMN_GROUPS]

/** Grid-side column metadata. `kind` comes from EMPLOYEE_COLUMNS. */
export interface ColumnMeta {
  /** Indonesian header label (matches the retired FIELD_LABELS exactly). */
  label: string
  /** Grouping tab this column belongs to. */
  group: ColumnGroupKey
  /** Cell alignment. Numeric columns align end so digits line up. */
  align: 'start' | 'end'
  /** Default column width in px. */
  width: number
  /** Whether the grid may PATCH this cell in place. */
  editable: boolean
}

/** Presentation metadata for the 29 editable data columns. */
export const COLUMN_META: Record<string, ColumnMeta> = {
  division: { label: 'Divisi', group: COLUMN_GROUPS.KEPEGAWAIAN, align: 'start', width: 110, editable: true },
  sub_divisi: { label: 'Sub-divisi', group: COLUMN_GROUPS.KEPEGAWAIAN, align: 'start', width: 110, editable: true },
  no: { label: 'No.', group: COLUMN_GROUPS.IDENTITAS, align: 'end', width: 70, editable: true },
  nama: { label: 'Nama', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 220, editable: true },
  status: { label: 'Status', group: COLUMN_GROUPS.KEPEGAWAIAN, align: 'start', width: 100, editable: true },
  status2: { label: 'Status (2)', group: COLUMN_GROUPS.KEPEGAWAIAN, align: 'start', width: 100, editable: true },
  gender: { label: 'LK/PR', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 70, editable: true },
  jabatan: { label: 'Jabatan', group: COLUMN_GROUPS.KEPEGAWAIAN, align: 'start', width: 150, editable: true },
  catatan: { label: 'Catatan', group: COLUMN_GROUPS.KEPEGAWAIAN, align: 'start', width: 220, editable: true },
  tanggal_masuk: { label: 'Tgl masuk', group: COLUMN_GROUPS.KEPEGAWAIAN, align: 'start', width: 110, editable: true },
  tanggal_lahir: { label: 'Tgl lahir', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 110, editable: true },
  tempat_lahir: { label: 'Tempat lahir', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 150, editable: true },
  no_ktp: { label: 'No. KTP', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 170, editable: true },
  no_kk: { label: 'No. KK', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 170, editable: true },
  no_rekening: { label: 'No. rekening', group: COLUMN_GROUPS.BPJS_BANK, align: 'start', width: 170, editable: true },
  no_bpjs_tk: { label: 'No. BPJS TK', group: COLUMN_GROUPS.BPJS_BANK, align: 'start', width: 160, editable: true },
  gaji_pokok: { label: 'Gaji pokok', group: COLUMN_GROUPS.PENGGAJIAN, align: 'end', width: 130, editable: true },
  tunjangan_masa_kerja: { label: 'Tunjangan masa kerja', group: COLUMN_GROUPS.PENGGAJIAN, align: 'end', width: 150, editable: true },
  gaji_total: { label: 'Gaji + tunjangan tetap', group: COLUMN_GROUPS.PENGGAJIAN, align: 'end', width: 160, editable: true },
  upah: { label: 'Upah', group: COLUMN_GROUPS.PENGGAJIAN, align: 'end', width: 130, editable: true },
  bpjs_kesehatan: { label: 'BPJS kesehatan', group: COLUMN_GROUPS.BPJS_BANK, align: 'start', width: 140, editable: true },
  bpjs_jamsostek: { label: 'BPJS Jamsostek', group: COLUMN_GROUPS.BPJS_BANK, align: 'start', width: 140, editable: true },
  nama_ibu: { label: 'Nama ibu', group: COLUMN_GROUPS.KELUARGA, align: 'start', width: 150, editable: true },
  nama_suami_istri: { label: 'Nama pasangan', group: COLUMN_GROUPS.KELUARGA, align: 'start', width: 150, editable: true },
  nama_anak: { label: 'Nama anak', group: COLUMN_GROUPS.KELUARGA, align: 'start', width: 150, editable: true },
  agama: { label: 'Agama', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 100, editable: true },
  pendidikan: { label: 'Pendidikan', group: COLUMN_GROUPS.IDENTITAS, align: 'start', width: 110, editable: true },
  alamat: { label: 'Alamat', group: COLUMN_GROUPS.ALAMAT, align: 'start', width: 240, editable: true },
  domisili: { label: 'Domisili', group: COLUMN_GROUPS.ALAMAT, align: 'start', width: 150, editable: true },
}

/**
 * Read-only audit columns. They are in the SELECT list but NOT in
 * EMPLOYEE_COLUMNS, so they can never be written — the grid renders them as
 * locked cells.
 */
export const AUDIT_COLUMNS: ReadonlyArray<{ key: string; label: string; kind: ColumnKind; width: number }> = [
  { key: 'created_by', label: 'Dibuat oleh', kind: 'string', width: 140 },
  { key: 'updated_by', label: 'Diubah oleh', kind: 'string', width: 140 },
  { key: 'created_at', label: 'Dibuat', kind: 'date', width: 130 },
  { key: 'updated_at', label: 'Diubah', kind: 'date', width: 130 },
]

/** One wire-ready column descriptor (what GET /api/schema returns). */
export interface SchemaColumn {
  key: string
  label: string
  kind: ColumnKind
  group: ColumnGroupKey
  align: 'start' | 'end'
  width: number
  editable: boolean
  /** Which store backs the column — the grid must respect this. */
  source: 'EMPLOYEE_MASTER' | 'audit'
}

/**
 * Ordered wire schema: every editable column in EMPLOYEE_FIELDS order, then
 * the read-only audit columns. Order is stable so `<colgroup>` never shifts.
 */
export const COLUMN_SCHEMA: readonly SchemaColumn[] = [
  ...EMPLOYEE_FIELDS.map((key): SchemaColumn => {
    const meta = COLUMN_META[key]
    return {
      key,
      label: meta.label,
      kind: EMPLOYEE_COLUMNS[key],
      group: meta.group,
      align: meta.align,
      width: meta.width,
      editable: meta.editable,
      source: 'EMPLOYEE_MASTER',
    }
  }),
  ...AUDIT_COLUMNS.map((c): SchemaColumn => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
    group: COLUMN_GROUPS.JEJAK,
    align: 'start',
    width: c.width,
    editable: false,
    source: 'audit',
  })),
]

/**
 * Fail fast at import if the two registries drift. A missing meta entry would
 * otherwise become an undefined label / group at render time, which is much
 * harder to trace back to here.
 */
{
  const missing = EMPLOYEE_FIELDS.filter((k) => !COLUMN_META[k])
  const extra = Object.keys(COLUMN_META).filter((k) => !EMPLOYEE_FIELDS.includes(k))
  if (missing.length || extra.length) {
    throw new Error(
      `employeeSchema: COLUMN_META out of sync — missing [${missing.join(', ')}] extra [${extra.join(', ')}]`,
    )
  }
}

/** Group tabs in display order, each with its column keys. */
export const SCHEMA_GROUPS = (Object.values(COLUMN_GROUPS) as ColumnGroupKey[]).map((label) => ({
  label,
  keys: COLUMN_SCHEMA.filter((c) => c.group === label).map((c) => c.key),
})).filter((g) => g.keys.length > 0)
