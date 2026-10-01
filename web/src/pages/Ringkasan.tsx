import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  actionLabel,
  FIELD_LABELS,
  nf,
  type DashboardResponse,
  type MeResponse,
} from '../api'

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

  const maxDivision = Math.max(1, ...(data?.byDivision.map((d) => d.count) ?? [1]))

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

      <div className="dashgrid">
        {/* Division bars */}
        <section className="panel" aria-label="Sebaran per divisi">
          <div className="panel__head">
            <h2>Sebaran per divisi</h2>
            <Link className="label-caps" to="/daftar">
              lihat data →
            </Link>
          </div>
          <div className="bars">
            {(data?.byDivision ?? []).map((d) => (
              <div className="bar" key={d.division}>
                <span className="bar__name" title={d.division}>
                  {d.division}
                </span>
                <span className="bar__track">
                  <span
                    className="bar__fill"
                    style={{ width: `${Math.max(2, (d.count / maxDivision) * 100)}%` }}
                  />
                </span>
                <span className="bar__n tnum">{nf.format(d.count)}</span>
              </div>
            ))}
            {!data && (
              <div className="bar">
                <span className="skel" style={{ gridColumn: '1 / -1' }} />
              </div>
            )}
          </div>
        </section>

        {/* Recent changes feed */}
        <section className="panel" aria-label="Perubahan terbaru">
          <div className="panel__head">
            <h2>Perubahan terbaru</h2>
            <Link className="label-caps" to="/riwayat">
              semua riwayat →
            </Link>
          </div>
          <div className="feed">
            {(data?.recentChanges ?? []).map((c) => (
              <div className="feed__item" key={c.id}>
                <div className="feed__top">
                  <span className="feed__who">{c.changed_by ?? '–'}</span>
                  <span className="feed__what">
                    {actionLabel(c.action)}{' '}
                    {c.action === 'update' && c.field ? (
                      <>
                        <b>{FIELD_LABELS[c.field] ?? c.field}</b> {c.employee_name}
                      </>
                    ) : (
                      <b>{c.employee_name}</b>
                    )}
                  </span>
                  <span className="feed__when">{c.changed_at ? new Date(c.changed_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                {c.action === 'update' && (c.old_value || c.new_value) && (
                  <span className="feed__delta">
                    <s>{c.old_value ?? '–'}</s> → <b>{c.new_value ?? '–'}</b>
                  </span>
                )}
              </div>
            ))}
            {data && (data.recentChanges?.length ?? 0) === 0 && (
              <div className="empty">
                <span className="empty__mark" aria-hidden="true">
                  ✓
                </span>
                <p>Belum ada perubahan tercatat.</p>
                <p>Setiap edit dari siapa pun akan muncul di sini.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
