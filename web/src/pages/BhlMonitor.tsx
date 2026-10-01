import { useCallback, useEffect, useState } from 'react'
import { api, type Employee, type MeResponse } from '../api'

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

export default function BhlMonitor({ me }: { me: MeResponse }) {
  const [data, setData] = useState<BhlItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'overdue' | 'warning' | 'upcoming'>('all')

  const load = useCallback(async () => {
    setLoading(true)
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

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th className="row-num">#</th>
              <th>Nama</th>
              <th>Divisi</th>
              <th>Jabatan</th>
              <th>Tgl Masuk</th>
              <th>Hari Ke-</th>
              <th>Sisa Hari</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td colSpan={8}>
                    <div className="skel" style={{ width: `${90 - i * 6}%` }} />
                  </td>
                </tr>
              ))}
            {!loading &&
              filtered.map((row, idx) => (
                <tr key={row.id}>
                  <td className="row-num">{idx + 1}</td>
                  <td>
                    <span className="cell-name">{row.nama}</span>
                  </td>
                  <td>
                    <span className="tag">{row.division}</span>
                    {row.sub_divisi && <span className="cell-sub">{row.sub_divisi}</span>}
                  </td>
                  <td>{row.jabatan}</td>
                  <td className="tnum">{new Date(row.tanggal_masuk).toLocaleDateString('id-ID')}</td>
                  <td className="tnum">{row.days_elapsed}</td>
                  <td className="tnum">
                    {row.days_remaining < 0 ? (
                      <span style={{ color: 'var(--color-error)' }}>{Math.abs(row.days_remaining)} hari lalu</span>
                    ) : (
                      row.days_remaining
                    )}
                  </td>
                  <td>
                    <span className={`tag ${STATUS_CLASS[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="empty">
            <p>Tidak ada data BHL untuk filter ini.</p>
          </div>
        )}
      </div>

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
