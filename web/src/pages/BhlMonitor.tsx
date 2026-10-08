import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Employee, type MeResponse } from '../api'
import Sheet, { type SheetColumn, type SheetGroup } from '../components/Sheet'

const BHL_DAYS = 70
const MAX_OVERDUE_DAYS = 30 // terlambat maksimal 1 bulan

interface BhlItem {
  id: number
  nama: string
  division: string
  sub_divisi: string
  jabatan: string
  tanggal_masuk: string
  days_elapsed: number
  days_remaining: number
  status: 'overdue' | 'warning' | 'upcoming'
}

function calcBhl(tanggal_masuk: string): { days_elapsed: number; days_remaining: number; status: BhlItem['status'] } | null {
  const masuk = new Date(tanggal_masuk)
  const now = new Date()
  const diff = Math.floor((now.getTime() - masuk.getTime()) / (1000 * 60 * 60 * 24))
  const remaining = BHL_DAYS - diff
  
  // Skip if more than MAX_OVERDUE_DAYS overdue
  if (remaining < -MAX_OVERDUE_DAYS) return null
  
  let status: BhlItem['status'] = 'upcoming'
  if (remaining < 0) status = 'overdue'
  else if (remaining <= 14) status = 'warning'
  return { days_elapsed: diff, days_remaining: remaining, status }
}

const STATUS_LABEL: Record<BhlItem['status'], string> = {
  overdue: 'Terlambat',
  warning: 'Segera',
  upcoming: 'Akan Datang',
}

const STATUS_CLASS: Record<BhlItem['status'], string> = {
  overdue: 'tag--danger',
  warning: 'tag--warn',
  upcoming: 'tag--muted',
}

const BHL_GROUPS: SheetGroup[] = [
  { label: 'Karyawan', keys: ['nama', 'division', 'jabatan'] },
  { label: 'Penilaian BHL', keys: ['tanggal_masuk', 'days_elapsed', 'days_remaining', 'status'] },
]

const BHL_COLUMNS: SheetColumn<BhlItem>[] = [
  { key: 'nama', label: 'Nama', group: 'Karyawan', type: 'string', width: 220,
    render: (r) => <span className="cell-name">{r.nama}</span> },
  { key: 'division', label: 'Divisi', group: 'Karyawan', type: 'string', width: 140,
    render: (r) => (
      <>
        <span className="tag">{r.division}</span>
        {r.sub_divisi && <span className="cell-sub">{r.sub_divisi}</span>}
      </>
    ) },
  { key: 'jabatan', label: 'Jabatan', group: 'Karyawan', type: 'string', width: 170 },

  { key: 'tanggal_masuk', label: 'Tgl masuk', group: 'Penilaian BHL', type: 'date', width: 130 },
  { key: 'days_elapsed', label: 'Hari ke-', group: 'Penilaian BHL', type: 'int', width: 100, align: 'end' },
  { key: 'days_remaining', label: 'Sisa hari', group: 'Penilaian BHL', type: 'int', width: 120, align: 'end',
    render: (r) =>
      r.days_remaining < 0 ? (
        <span className="bhl__late">{Math.abs(r.days_remaining)} hari lalu</span>
      ) : (
        <span>{r.days_remaining}</span>
      ) },
  { key: 'status', label: 'Status', group: 'Penilaian BHL', type: 'string', width: 130,
    render: (r) => (
      <span className={`tag ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
    ) },
]

export default function BhlMonitor({ me }: { me: MeResponse }) {
  const [data, setData] = useState<BhlItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'overdue' | 'warning' | 'upcoming'>('all')

  /** Bookkeeping for the live poll (last seen count + updated_at high-water mark). */
  const lastWm = useRef({ total: -1, watermark: -1 })

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await api.listEmployees({ limit: 500, sort: 'tanggal_masuk', dir: 'desc' })
      const items: BhlItem[] = res.items
        .filter((e: Employee) => e.tanggal_masuk)
        .map((e: Employee) => {
          const bhl = calcBhl(e.tanggal_masuk!)
          if (!bhl) return null
          return {
            id: e.id,
            nama: e.nama,
            division: e.division,
            sub_divisi: e.sub_divisi,
            jabatan: e.jabatan,
            tanggal_masuk: e.tanggal_masuk!,
            ...bhl,
          }
        })
        .filter((item): item is BhlItem => item !== null)
      setData(items)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data BHL')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Live, like every other data surface in the module. This page previously had
  // no poll at all, so `days_elapsed` / `days_remaining` silently drifted out of
  // date for as long as the tab stayed open — a BHL date crossing 70 days would
  // not appear until a manual reload. Poll the cheap watermark and only refetch
  // when the underlying data actually moved.
  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const wm = await api.watermark()
        if (wm.total !== lastWm.current.total || wm.watermark !== lastWm.current.watermark) {
          lastWm.current = wm
          load(true)
        }
      } catch {
        /* transient — the next tick retries */
      }
    }, 5000)
    return () => window.clearInterval(id)
  }, [load])

  const filtered = filter === 'all' ? data : data.filter((d) => d.status === filter)
  const counts = {
    all: data.length,
    overdue: data.filter((d) => d.status === 'overdue').length,
    warning: data.filter((d) => d.status === 'warning').length,
    upcoming: data.filter((d) => d.status === 'upcoming').length,
  }

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Monitor BHL</h1>
          <p className="page__desc">
            Penilaian BHL (70 hari sejak tanggal masuk kerja). Menampilkan karyawan yang segera,
            akan datang, atau terlambat (maksimal 1 bulan).
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="searchpill" style={{ maxWidth: '20rem' }}>
          <span aria-hidden="true" className="label-caps" style={{ color: 'var(--color-neutral)' }}>
            Filter
          </span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            aria-label="Filter status BHL"
          >
            <option value="all">Semua ({counts.all})</option>
            <option value="overdue">Terlambat ({counts.overdue})</option>
            <option value="warning">Segera ({counts.warning})</option>
            <option value="upcoming">Akan Datang ({counts.upcoming})</option>
          </select>
        </div>
        <span className="toolbar__count" aria-live="polite">
          {filtered.length} karyawan
        </span>
      </div>

      {error && (
        <div className="toast toast--error" role="alert">
          {error}
        </div>
      )}

      <Sheet<BhlItem>
        ariaLabel="Monitor BHL (penilaian 70 hari)"
        columns={BHL_COLUMNS}
        groups={BHL_GROUPS}
        rows={filtered}
        rowKey={(r) => r.id}
        frozenKeys={['nama']}
        loading={loading}
        height="calc(100dvh - 15rem)"
        empty={
          <div className="empty">
            <p>Tidak ada data BHL untuk filter ini.</p>
          </div>
        }
      />

      <div className="statusbar">
        <span className="status-item">
          <span className="dot"></span>
          BHL = 70 hari sejak tanggal masuk
        </span>
        <span className="status-item">
          <span className="dot warning"></span>
          Segera = ≤14 hari lagi
        </span>
        <span className="status-item">
          <span className="dot" style={{ background: 'var(--color-error)' }}></span>
          Terlambat = lewat 70 hari (maks 30 hari)
        </span>
      </div>
    </main>
  )
}
