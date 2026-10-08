import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { actionLabel, api, FIELD_LABELS, type ChangeRow } from '../api'
import Sheet, { type SheetColumn, type SheetGroup } from '../components/Sheet'

const LIMIT = 200

const RIWAYAT_GROUPS: SheetGroup[] = [
  { label: 'Peristiwa', keys: ['changed_at', 'changed_by', 'action'] },
  { label: 'Sasaran', keys: ['employee_name', 'employee_id', 'field'] },
  { label: 'Nilai', keys: ['old_value', 'new_value'] },
]

/** One decimal from a raw value; '–' for empty. */
const shown = (v: string | null) => (v == null || v === '' ? '–' : v)

const RIWAYAT_COLUMNS: SheetColumn<ChangeRow>[] = [
  { key: 'changed_at', label: 'Waktu', group: 'Peristiwa', type: 'date', width: 170,
    render: (c) => new Date(c.changed_at).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
    }) },
  { key: 'changed_by', label: 'Oleh', group: 'Peristiwa', type: 'string', width: 140,
    render: (c) => <span className="cell-name">{c.changed_by ?? '–'}</span> },
  { key: 'action', label: 'Aksi', group: 'Peristiwa', type: 'string', width: 110,
    render: (c) => (
      <span className={`tag${c.action === 'create' ? ' tag--accent' : c.action === 'delete' ? ' tag--danger' : ''}`}>
        {actionLabel(c.action)}
      </span>
    ) },
  { key: 'employee_name', label: 'Karyawan', group: 'Sasaran', type: 'string', width: 200 },
  { key: 'employee_id', label: 'ID', group: 'Sasaran', type: 'int', width: 80, align: 'end',
    render: (c) => <span className="mono">{c.employee_id}</span> },
  { key: 'field', label: 'Field', group: 'Sasaran', type: 'string', width: 150,
    render: (c) => (c.field ? FIELD_LABELS[c.field] ?? c.field : '–') },
  { key: 'old_value', label: 'Nilai lama', group: 'Nilai', type: 'string', width: 200,
    render: (c) => <span className="riwayat__old mono">{shown(c.old_value)}</span> },
  { key: 'new_value', label: 'Nilai baru', group: 'Nilai', type: 'string', width: 200,
    render: (c) => <span className="riwayat__new mono">{shown(c.new_value)}</span> },
]

/**
 * Riwayat — the audit trail. Who changed what, when. New entries appear via
 * the same 5s watermark-style polling (here: id cursor), newest first.
 */
export default function Riwayat() {
  const [items, setItems] = useState<ChangeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [employeeId, setEmployeeId] = useState('')

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const res = await api.changes({ limit: LIMIT, employee_id: employeeId || undefined })
        setItems(res.items)
        setError('')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat riwayat')
      } finally {
        setLoading(false)
      }
    },
    [employeeId],
  )

  useEffect(() => {
    load()
    const id = window.setInterval(() => load(true), 5000)
    return () => window.clearInterval(id)
  }, [load])

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Riwayat perubahan</h1>
          <p className="page__desc">
            Jejak audit Data Manual: siapa mengubah apa, kapan. Baris dihapus pun tetap
            tercatat di sini.
          </p>
        </div>
        <Link className="btn" to="/daftar">
          ← Kembali ke daftar
        </Link>
      </div>

      <div className="toolbar">
        <div className="field" style={{ maxWidth: '16rem' }}>
          <label htmlFor="rid">ID karyawan</label>
          <input
            id="rid"
            className="input"
            inputMode="numeric"
            value={employeeId}
            placeholder="semua karyawan"
            onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <span className="toolbar__count" aria-live="polite">
          {loading ? 'memuat…' : `${items.length} entri terbaru`}
        </span>
      </div>

      {error && (
        <div className="toast toast--error" role="alert">
          {error}
        </div>
      )}

      <Sheet<ChangeRow>
        ariaLabel="Riwayat perubahan karyawan (hanya baca)"
        columns={RIWAYAT_COLUMNS}
        groups={RIWAYAT_GROUPS}
        rows={items}
        rowKey={(c) => c.id}
        frozenKeys={['changed_at']}
        loading={loading}
        height="calc(100dvh - 15rem)"
        empty={
          <div className="empty">
            <span className="empty__mark" aria-hidden="true">
              ✓
            </span>
            <p>Belum ada perubahan tercatat{employeeId ? ` untuk ID ${employeeId}` : ''}.</p>
            <p>Setiap tambah, ubah, atau hapus dari Data Manual akan muncul di sini.</p>
            <Link className="btn btn--sm" to="/daftar">
              Buka Data Manual
            </Link>
          </div>
        }
      />
    </main>
  )
}
