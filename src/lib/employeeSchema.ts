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
