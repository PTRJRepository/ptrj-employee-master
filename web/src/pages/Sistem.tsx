import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  nf,
  shortDate,
  type DeptRow,
  type ListResponse,
  type SistemEmployee,
  type SistemFamily,
} from '../api'

const LIMIT = 50

const REL_LABELS: Record<string, string> = {
  '1': 'Suami / istri',
  '2': 'Anak',
  '3': 'Keluarga lain',
  '7': 'Tanggungan lain',
}

/* ── Read-only detail drawer ────────────────────────────────────── */
function SistemDrawer({ code, onClose }: { code: string; onClose: () => void }) {
  const [item, setItem] = useState<SistemEmployee | null>(null)
  const [family, setFamily] = useState<SistemFamily[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')

  useEffect(() => {
    let alive = true
    api
      .sistemDetail(code)
      .then((r) => {
        if (!alive) return
        setItem(r.item)
        setFamily(r.family)
        setState('ok')
      })
      .catch(() => alive && setState('missing'))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
    }
  }, [code, onClose])

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <>
      <dt>{label}</dt>
      <dd>{value ?? '–'}</dd>
    </>
  )

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Detail sistem ${code}`}>
        <div className="drawer__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="label-caps">db_ptrj · HR_EMPLOYEE · {code}</span>
            <h2>{item?.EmpName ?? code}</h2>
          </div>
          <span className={`tag${item?.is_active ? ' tag--accent' : ' tag--muted'}`}>
            {item?.is_active ? 'aktif' : 'tidak aktif'}
          </span>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Tutup detail">
            ✕
          </button>
        </div>
        <div className="drawer__body">
          {state === 'loading' && <div className="skel" style={{ height: 120 }} />}
          {state === 'missing' && (
            <div className="empty">
              <p>Data tidak ditemukan di db_ptrj.</p>
            </div>
          )}
          {state === 'ok' && item && (
            <>
              <section className="fsection">
                <h3>Kepegawaian</h3>
                <dl className="dl">
                  <Row label="Kode" value={<span className="mono">{item.emp_code}</span>} />
                  <Row label="Dept" value={`${item.DeptCode ?? '–'} ${item.dept_name ? `· ${String(item.dept_name).trim()}` : ''}`} />
                  <Row label="Jabatan" value={item.pos_name ? String(item.pos_name).trim() : item.PosCode} />
                  <Row label="Lokasi" value={item.LocCode} />
                  <Row label="Gang" value={item.GangCode} />
                  <Row label="Level" value={item.LevelCode} />
                  <Row label="Tgl masuk" value={shortDate(item.AppJoinDate)} />
                  <Row label="Tgl berhenti" value={shortDate(item.TerminateDate)} />
                </dl>
              </section>
              <section className="fsection">
                <h3>Identitas</h3>
                <dl className="dl">
                  <Row label="JK" value={item.gender_label || item.Gender} />
                  <Row label="No. KTP" value={<span className="mono">{item.NewICNo}</span>} />
                  <Row label="Tgl lahir" value={`${item.PlaceOfBirth ? `${String(item.PlaceOfBirth).trim()}, ` : ''}${shortDate(item.DOB)}`} />
                  <Row label="Agama" value={item.Religion} />
                  <Row label="Telepon" value={item.MobileTel} />
                  <Row label="Alamat" value={item.ResAddress} />
                  <Row label="Status HR" value={item.Status} />
                </dl>
              </section>
              <section className="fsection">
                <h3>Keluarga (HR_EMPFAM)</h3>
                {family.length === 0 ? (
                  <p className="page__desc">Tidak ada data keluarga tercatat.</p>
                ) : (
                  <dl className="dl">
                    {family.map((f) => (
                      <Row
                        key={f.FamilyID}
                        label={REL_LABELS[String(f.Relationship).trim()] ?? `Relasi ${f.Relationship}`}
                        value={`${f.FamName}${f.DOB ? ` · ${shortDate(f.DOB)}` : ''}`}
                      />
                    ))}
                  </dl>
                )}
              </section>
              <p className="page__desc">
                Sumber <b>hanya baca</b>: data produksi db_ptrj tidak bisa diubah dari portal ini.
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  )
}

/* ── Page ───────────────────────────────────────────────────────── */
export default function Sistem() {
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [active, setActive] = useState('Y')
  const [page, setPage] = useState(1)
  const [depts, setDepts] = useState<DeptRow[]>([])
  const [data, setData] = useState<ListResponse<SistemEmployee> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const res = await api.sistemList({ q, dept, active, page, limit: LIMIT })
      if (seq !== loadSeq.current) return // newer request superseded this one
      setData(res)
      setError('')
      if (res.items.length === 0 && page > 1) setPage((p) => Math.max(1, p - 1))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data sistem')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [q, dept, active, page])

  useEffect(() => {
    api.sistemDepts().then((r) => setDepts(r.items)).catch(() => {})
  }, [])

  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [load, q])

  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Data Sistem</h1>
          <p className="page__desc">
            Produksi <span className="mono">db_ptrj.HR_EMPLOYEE</span>, hanya baca. Cocokkan
            dengan Data Manual untuk melihat selisih.
          </p>
        </div>
        <Link className="btn btn--primary" to="/daftar">
          Data Manual (edit)
        </Link>
      </div>

      <div className="toolbar">
        <div className="searchpill" style={{ maxWidth: '20rem' }}>
          <span aria-hidden="true" className="label-caps" style={{ color: 'var(--color-neutral)' }}>
            Cari
          </span>
          <input
            type="search"
            value={q}
            placeholder="Nama, kode, KTP, alamat…"
            aria-label="Cari dalam data sistem"
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={dept} aria-label="Filter departemen" onChange={(e) => { setDept(e.target.value); setPage(1) }}>
          <option value="">Semua dept</option>
          {depts.map((d) => (
            <option key={d.dept_code} value={d.dept_code}>
              {d.dept_code} · {d.dept_name} ({d.headcount})
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={active} aria-label="Filter status aktif" onChange={(e) => { setActive(e.target.value); setPage(1) }}>
          <option value="">Semua status</option>
          <option value="Y">Aktif</option>
          <option value="N">Tidak aktif</option>
        </select>
        <span className="toolbar__count" aria-live="polite">
          {data ? `${nf.format((page - 1) * LIMIT + data.items.length)} dari ${nf.format(total)} karyawan` : 'memuat…'}
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
              <th>Kode</th>
              <th>Nama</th>
              <th>JK</th>
              <th>Dept</th>
              <th>Jabatan</th>
              <th>Tgl masuk</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td colSpan={7}>
                    <div className="skel" style={{ width: `${90 - i * 6}%` }} />
                  </td>
                </tr>
              ))}
            {!loading &&
              (data?.items ?? []).map((row) => (
                <tr
                  key={row.emp_code}
                  tabIndex={0}
                  onClick={() => setSelected(row.emp_code)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelected(row.emp_code)
                    }
                  }}
                >
                  <td className="mono">{row.emp_code}</td>
                  <td>
                    <span className="cell-name">{String(row.EmpName).trim()}</span>
                    {row.NewICNo && <span className="cell-sub mono">{row.NewICNo}</span>}
                  </td>
                  <td>{row.gender_label || row.Gender}</td>
                  <td>
                    <span className="tag">{row.DeptCode ?? '–'}</span>
                    {row.dept_name && <span className="cell-sub">{String(row.dept_name).trim()}</span>}
                  </td>
                  <td>{row.pos_name ? String(row.pos_name).trim() : row.PosCode ?? '–'}</td>
                  <td className="tnum">{shortDate(row.AppJoinDate)}</td>
                  <td>
                    <span className={`tag${row.is_active ? ' tag--accent' : ' tag--muted'}`}>
                      {row.is_active ? 'aktif' : 'tidak aktif'}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && (data?.items.length ?? 0) === 0 && (
          <div className="empty">
            <span className="empty__mark" aria-hidden="true">
              ⌕
            </span>
            <p>Tidak ada karyawan sistem yang cocok.</p>
            <p>Filter dept atau status aktif mungkin terlalu sempit.</p>
            {(q || dept || active !== 'Y') && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setQ('')
                  setDept('')
                  setActive('Y')
                }}
              >
                Bersihkan filter
              </button>
            )}
          </div>
        )}
      </div>

      <div className="pager">
        <button type="button" className="btn btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ← Sebelumnya
        </button>
        <span className="pager__pos tnum">
          Halaman {page} / {totalPages}
        </span>
        <button type="button" className="btn btn--sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          Berikutnya →
        </button>
      </div>

      {selected && <SistemDrawer code={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}
