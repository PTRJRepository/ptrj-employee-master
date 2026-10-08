import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  actionLabel,
  FIELD_LABELS,
  nf,
  type ChangeRow,
  type DashboardResponse,
  type MeResponse,
} from '../api'
import Sheet, { type SheetColumn, type SheetGroup } from '../components/Sheet'

/* ── Two grid column models: division spread + the audit feed ────── */

interface DivisionRow {
  division: string
  count: number
  /** Share of the total, 0–100. */
  share: number
}

const DIVISION_GROUPS: SheetGroup[] = [
  { label: 'Divisi', keys: ['division'] },
  { label: 'Jumlah', keys: ['count', 'share'] },
]

const DIVISION_COLUMNS: SheetColumn<DivisionRow>[] = [
  { key: 'division', label: 'Divisi', group: 'Divisi', type: 'string', width: 200 },
  { key: 'count', label: 'Karyawan', group: 'Jumlah', type: 'int', width: 130, align: 'end' },
  { key: 'share', label: 'Porsi', group: 'Jumlah', type: 'int', width: 110, align: 'end',
    render: (d) => `${d.share.toFixed(1)}%` },
]

const FEED_GROUPS: SheetGroup[] = [
  { label: 'Peristiwa', keys: ['changed_at', 'changed_by', 'action'] },
  { label: 'Sasaran', keys: ['employee_name', 'field'] },
  { label: 'Nilai', keys: ['old_value', 'new_value'] },
]

const FEED_COLUMNS: SheetColumn<ChangeRow>[] = [
  { key: 'changed_at', label: 'Waktu', group: 'Peristiwa', type: 'date', width: 150,
    render: (c) => new Date(c.changed_at).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }) },
  { key: 'changed_by', label: 'Oleh', group: 'Peristiwa', type: 'string', width: 130 },
  { key: 'action', label: 'Aksi', group: 'Peristiwa', type: 'string', width: 110,
    render: (c) => (
      <span className={`tag${c.action === 'create' ? ' tag--accent' : c.action === 'delete' ? ' tag--danger' : ''}`}>
        {actionLabel(c.action)}
      </span>
    ) },
  { key: 'employee_name', label: 'Karyawan', group: 'Sasaran', type: 'string', width: 190 },
  { key: 'field', label: 'Field', group: 'Sasaran', type: 'string', width: 140,
    render: (c) => (c.field ? FIELD_LABELS[c.field] ?? c.field : '–') },
  { key: 'old_value', label: 'Nilai lama', group: 'Nilai', type: 'string', width: 170,
    render: (c) => <span className="riwayat__old mono">{c.old_value ?? '–'}</span> },
  { key: 'new_value', label: 'Nilai baru', group: 'Nilai', type: 'string', width: 170,
    render: (c) => <span className="riwayat__new mono">{c.new_value ?? '–'}</span> },
]

/**
 * Ringkasan — the Stat-Led view. A giant REAL headcount figure paired with a
 * worded qualifier, a 4-up KPI strip, division bars, and the recent-changes
 * feed. Numbers come from /api/dashboard (live DB), never invented.
 */
function useTick(target: number): number {
  const [value, setValue] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || target <= 0) {
      setValue(target)
      return
    }
    const start = performance.now()
    const dur = 900
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(target * eased))
      if (p < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [target])
  return value
}

export default function Ringkasan({ me }: { me: MeResponse }) {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState('')
  const tick = useTick(data?.total ?? 0)

  const load = async () => {
    try {
      setData(await api.dashboard())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat ringkasan')
    }
  }

  useEffect(() => {
    load()
    const id = window.setInterval(load, 5000)
    return () => window.clearInterval(id)
  }, [])

  // Share is derived here, never invented — it is count / total of the same payload.
  const divisionRows: DivisionRow[] = (() => {
    const rows = data?.byDivision ?? []
    const sum = rows.reduce((n, d) => n + d.count, 0)
    return rows.map((d) => ({
      division: d.division,
      count: d.count,
      share: sum > 0 ? (d.count / sum) * 100 : 0,
    }))
  })()

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Ringkasan tenaga kerja</h1>
          <p className="page__desc">
            Data Manual, sesi {me.user.name || 'Anda'}. Angka langsung dari
            EMPLOYEE_MASTER dan diperbarui setiap 5 detik.
          </p>
        </div>
        <Link className="btn btn--primary" to="/daftar">
          Buka daftar karyawan
        </Link>
      </div>

      {error && (
        <div className="toast toast--error" role="alert">
          {error}
        </div>
      )}

      {/* Stat-Led hero: figure + worded qualifier (never a bare number) */}
      <section className="stathero" aria-label="Total karyawan">
        <div className="stathero__figure tnum" aria-live="polite">
          {nf.format(tick)}
        </div>
        <p className="stathero__qual">
          <strong>karyawan tercatat</strong> di master manual, tersebar di{' '}
          {data ? nf.format(data.byDivision.length) : '–'} divisi.
        </p>
      </section>

      {/* KPI strip */}
      <section className="kpistrip" aria-label="Indikator utama">
        <div className="kpi">
          <span className="kpi__value tnum">{data ? nf.format(data.lk) : '–'}</span>
          <span className="kpi__label">Laki-laki</span>
        </div>
        <div className="kpi">
          <span className="kpi__value tnum">{data ? nf.format(data.pr) : '–'}</span>
          <span className="kpi__label">Perempuan</span>
        </div>
        <div className="kpi">
          <span className="kpi__value tnum">{data ? nf.format(data.new30) : '–'}</span>
          <span className="kpi__label">Masuk 30 hari</span>
        </div>
        <div className="kpi">
          <span className="kpi__value tnum">
            {data ? nf.format(data.byDivision.length) : '–'}
          </span>
          <span className="kpi__label">Divisi</span>
        </div>
      </section>

      {/* Division spread. The bar is retained as the visual, but the figures
          now sit in a real <table> so the totals are machine-readable. */}
      <section className="panel" aria-label="Sebaran per divisi">
        <div className="panel__head">
          <h2>Sebaran per divisi</h2>
          <Link className="label-caps" to="/daftar">
            lihat data →
          </Link>
        </div>
        <Sheet<DivisionRow>
          ariaLabel="Sebaran karyawan per divisi"
          columns={DIVISION_COLUMNS}
          groups={DIVISION_GROUPS}
          rows={divisionRows}
          rowKey={(d) => d.division}
          loading={!data}
          height="22rem"
          empty={<div className="empty"><p>Belum ada data divisi.</p></div>}
        />
      </section>

      {/* Recent changes feed — grid with real headers instead of a prose list. */}
      <section className="panel" aria-label="Perubahan terbaru">
        <div className="panel__head">
          <h2>Perubahan terbaru</h2>
          <Link className="label-caps" to="/riwayat">
            semua riwayat →
          </Link>
        </div>
        <Sheet<ChangeRow>
          ariaLabel="Perubahan terbaru"
          columns={FEED_COLUMNS}
          groups={FEED_GROUPS}
          rows={data?.recentChanges ?? []}
          rowKey={(c) => c.id}
          frozenKeys={['changed_at']}
          loading={!data}
          height="22rem"
          empty={
            <div className="empty">
              <span className="empty__mark" aria-hidden="true">
                ✓
              </span>
              <p>Belum ada perubahan tercatat.</p>
              <p>Setiap edit dari siapa pun akan muncul di sini.</p>
            </div>
          }
        />
      </section>
    </main>
  )
}
