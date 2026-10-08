/**
 * csv.ts — export the current grid selection as CSV.
 *
 * Exports what the operator can SEE (the visible columns, in view order, for
 * the selected rows) rather than the whole table — that is what "export" means
 * when a grid is filtered and column-trimmed.
 */

export interface CsvColumn<T> {
  key: string
  label: string
  /** Value for one row; falls back to the raw field when absent. */
  value?: (row: T) => unknown
}

/** RFC 4180 field: quote when the value contains a delimiter, quote or newline. */
function field(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T extends object>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => field(c.label)).join(',')
  const body = rows.map((r) =>
    columns
      .map((c) => field(c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]))
      .join(','),
  )
  return [head, ...body].join('\r\n')
}

/** Prefix a UTF-8 BOM so Excel on Windows reads the Indonesian text correctly. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick — Safari needs the URL alive through the click.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** "data-manual-2026-10-08.csv" */
export function stampedName(base: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${base}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`
}
