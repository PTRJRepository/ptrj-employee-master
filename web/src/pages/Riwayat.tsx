import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { actionLabel, api, FIELD_LABELS, type ChangeRow } from '../api'

const LIMIT = 100

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

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Oleh</th>
              <th>Aksi</th>
              <th>Karyawan</th>
              <th>Field</th>
              <th>Perubahan</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td colSpan={6}>
                    <div className="skel" style={{ width: `${90 - i * 6}%` }} />
                  </td>
                </tr>
              ))}
            {!loading &&
              items.map((c) => (
                <tr key={c.id}>
                  <td className="tnum" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(c.changed_at).toLocaleString('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    <span className="cell-name">{c.changed_by ?? '–'}</span>
                  </td>
                  <td>
                    <span className={`tag${c.action === 'delete' ? '' : c.action === 'create' ? ' tag--accent' : ''}`}>
                      {actionLabel(c.action)}
                    </span>
                  </td>
                  <td>
                    {c.employee_name}
                    <span className="cell-sub mono">ID {c.employee_id}</span>
                  </td>
                  <td>{c.field ? FIELD_LABELS[c.field] ?? c.field : '–'}</td>
                  <td className="mono" style={{ overflowWrap: 'anywhere' }}>
                    {c.action === 'update' ? (
                      <>
                        <span style={{ color: 'var(--color-neutral)' }}>{c.old_value ?? '–'}</span>{' '}
                        → <span style={{ color: 'var(--color-accent-deep)', fontWeight: 500 }}>{c.new_value ?? '–'}</span>
                      </>
                    ) : (
                      <span>{c.old_value ?? c.new_value ?? '–'}</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
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
        )}
      </div>
    </main>
  )
}
