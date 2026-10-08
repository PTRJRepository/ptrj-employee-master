import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import Sheet, { type SheetColumn, type SheetGroup } from '../components/Sheet'
import CardGrid, { type CardField } from '../components/CardGrid'
import ViewBar, { DENSITY_H, type Density, type ViewMode } from '../components/ViewBar'
import { usePersisted } from '../lib/prefs'
import { downloadCsv, stampedName, toCsv } from '../lib/csv'

/**
 * Rows per page. The API clamps `limit` to 500 (intParam(query.limit, 50, 500)
 * in src/routes/sistem.ts); the grid windows client-side so a larger page just
 * means more of the table is reachable in one scroll.
 */
const LIMIT = 250

const REL_LABELS: Record<string, string> = {
  '1': 'Suami / istri',
  '2': 'Anak',
  '3': 'Keluarga lain',
  '7': 'Tanggungan lain',
}

/* ── Grid column model ─────────────────────────────────────────────
 * Mirrors what /api/sistem/employees actually SELECTs. GangCode is
 * declared on SistemEmployee but NOT selected by the query, so it is
 * deliberately absent here (a column would render as '–' always).
 * ───────────────────────────────────────────────────────────────── */
const SISTEM_GROUPS: SheetGroup[] = [
  { label: 'Identitas', keys: ['EmpName', 'NewICNo', 'Gender', 'DOB', 'PlaceOfBirth', 'Religion', 'MaritalStatus'] },
  { label: 'Kontak', keys: ['MobileTel', 'ResAddress'] },
  { label: 'Kepegawaian', keys: ['emp_code', 'Status', 'HREmpType', 'AppJoinDate', 'TerminateDate'] },
  { label: 'Organisasi', keys: ['DeptCode', 'PosCode', 'LocCode', 'LevelCode', 'SalSchemeCode', 'SalGradeCode', 'is_active'] },
]

const SISTEM_COLUMNS: SheetColumn<SistemEmployee>[] = [
  { key: 'EmpName', label: 'Nama', group: 'Identitas', type: 'string', width: 220,
    render: (r) => <span className="cell-name">{String(r.EmpName).trim()}</span> },
  { key: 'NewICNo', label: 'No. KTP', group: 'Identitas', type: 'string', width: 170 },
  { key: 'Gender', label: 'JK', group: 'Identitas', type: 'string', width: 70,
    render: (r) => r.gender_label || r.Gender },
  { key: 'DOB', label: 'Tgl lahir', group: 'Identitas', type: 'date', width: 120 },
  { key: 'PlaceOfBirth', label: 'Tempat lahir', group: 'Identitas', type: 'string', width: 150 },
  { key: 'Religion', label: 'Agama', group: 'Identitas', type: 'string', width: 110 },
  { key: 'MaritalStatus', label: 'Status kawin', group: 'Identitas', type: 'string', width: 110 },

  { key: 'MobileTel', label: 'Telepon', group: 'Kontak', type: 'string', width: 140 },
  { key: 'ResAddress', label: 'Alamat', group: 'Kontak', type: 'string', width: 260 },

  { key: 'emp_code', label: 'Kode', group: 'Kepegawaian', type: 'string', width: 110,
    render: (r) => <span className="mono">{r.emp_code}</span> },
  { key: 'Status', label: 'Status HR', group: 'Kepegawaian', type: 'string', width: 110 },
  { key: 'HREmpType', label: 'Tipe', group: 'Kepegawaian', type: 'string', width: 100 },
  { key: 'AppJoinDate', label: 'Tgl masuk', group: 'Kepegawaian', type: 'date', width: 120 },
  { key: 'TerminateDate', label: 'Tgl berhenti', group: 'Kepegawaian', type: 'date', width: 120 },

  { key: 'DeptCode', label: 'Dept', group: 'Organisasi', type: 'string', width: 180,
    render: (r) => (
      <>
        <span className="tag">{r.DeptCode ?? '–'}</span>
        {r.dept_name && <span className="cell-sub">{String(r.dept_name).trim()}</span>}
      </>
    ) },
  { key: 'PosCode', label: 'Jabatan', group: 'Organisasi', type: 'string', width: 180,
    render: (r) => (r.pos_name ? String(r.pos_name).trim() : r.PosCode ?? '–') },
  { key: 'LocCode', label: 'Lokasi', group: 'Organisasi', type: 'string', width: 100 },
  { key: 'LevelCode', label: 'Level', group: 'Organisasi', type: 'string', width: 90 },
  { key: 'SalSchemeCode', label: 'Skema gaji', group: 'Organisasi', type: 'string', width: 110 },
  { key: 'SalGradeCode', label: 'Golongan', group: 'Organisasi', type: 'string', width: 110 },
  { key: 'is_active', label: 'Aktif', group: 'Organisasi', type: 'int', width: 110,
    render: (r) => (
      <span className={`tag${r.is_active ? ' tag--accent' : ' tag--muted'}`}>
        {r.is_active ? 'aktif' : 'tidak aktif'}
      </span>
    ) },
]

/* ── Read-only detail popup ────────────────────────────────────── */
function SistemPopup({ code, onClose }: { code: string; onClose: () => void }) {
  const [item, setItem] = useState<SistemEmployee | null>(null)
  const [family, setFamily] = useState<SistemFamily[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')
  const [wide, setWide] = useState(false)

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
    <div className="popup-overlay" onClick={onClose}>
      <div
        className={`popup${wide ? ' popup--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Detail sistem ${code}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="label-caps">db_ptrj · HR_EMPLOYEE · {code}</span>
            <h2>{item?.EmpName ?? code}</h2>
          </div>
          <span className={`tag${item?.is_active ? ' tag--accent' : ' tag--muted'}`}>
            {item?.is_active ? 'aktif' : 'tidak aktif'}
          </span>
          <div className="popup__actions">
            <button
              type="button"
              className="iconbtn"
              onClick={() => setWide(!wide)}
              aria-label={wide ? 'Sempitkan' : 'Perlebar'}
              title={wide ? 'Sempitkan' : 'Perlebar'}
            >
              {wide ? '⊟' : '⊞'}
            </button>
            <button type="button" className="iconbtn" onClick={onClose} aria-label="Tutup detail">
              ✕
            </button>
          </div>
        </div>
        <div className="popup__body">
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
      </div>
    </div>
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

  /* ── Working preferences ── */
  const [view, setView] = usePersisted<ViewMode>('sistem.view', 'tabel')
  const [density, setDensity] = usePersisted<Density>('sistem.density', 'rapat')
  const [hiddenArr, setHiddenArr] = usePersisted<string[]>('sistem.hidden', [])
  const hidden = useMemo(() => new Set(hiddenArr), [hiddenArr])
  const [picked, setPicked] = useState<Set<string | number>>(new Set())

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
  const items = data?.items ?? []

  const visibleColumns = useMemo(
    () => SISTEM_COLUMNS.filter((c) => !hidden.has(c.key)),
    [hidden],
  )

  const cardFields = (row: SistemEmployee): CardField[] => {
    // MaritalStatus / SalSchemeCode / SalGradeCode are SELECTed by the query but
    // absent from SistemEmployee, so read them through the record shape rather
    // than widening the shared API type for three display-only fields.
    const r = row as unknown as Record<string, unknown>
    const s = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v).trim())
    const out: CardField[] = []
    const push = (key: string, label: string, value: string, opts: Partial<CardField> = {}) => {
      if (value) out.push({ key, label, value, ...opts })
    }
    push('emp_code', 'Kode', s(row.emp_code), { tone: 'accent' })
    push('DeptCode', 'Dept', s(row.dept_name) || s(row.DeptCode))
    push('PosCode', 'Jabatan', s(row.pos_name) || s(row.PosCode))
    push('Status', 'Status HR', s(row.Status))
    push('AppJoinDate', 'Tgl masuk', shortDate(row.AppJoinDate), { numeric: true })
    push('is_active', 'Aktif', row.is_active ? 'aktif' : 'tidak aktif', {
      tone: row.is_active ? 'accent' : 'muted',
    })
    push('NewICNo', 'No. KTP', s(r.NewICNo), { numeric: true, detail: true })
    push('gender_label', 'JK', s(r.gender_label) || s(r.Gender), { detail: true })
    push('DOB', 'Tgl lahir', shortDate(row.DOB), { detail: true, numeric: true })
    push('PlaceOfBirth', 'Tempat lahir', s(r.PlaceOfBirth), { detail: true })
    push('Religion', 'Agama', s(r.Religion), { detail: true })
    push('MaritalStatus', 'Status kawin', s(r.MaritalStatus), { detail: true })
    push('MobileTel', 'Telepon', s(r.MobileTel), { detail: true, numeric: true })
    push('ResAddress', 'Alamat', s(r.ResAddress), { detail: true })
    push('LocCode', 'Lokasi', s(r.LocCode), { detail: true })
    push('LevelCode', 'Level', s(r.LevelCode), { detail: true })
    push('SalSchemeCode', 'Skema gaji', s(r.SalSchemeCode), { detail: true })
    push('SalGradeCode', 'Golongan', s(r.SalGradeCode), { detail: true })
    push('TerminateDate', 'Tgl berhenti', shortDate(row.TerminateDate), { detail: true, numeric: true })
    return out
  }

  const exportCsv = () => {
    const chosen = picked.size ? items.filter((r) => picked.has(r.emp_code)) : items
    downloadCsv(
      stampedName('data-sistem'),
      toCsv(visibleColumns.map((c) => ({ key: c.key, label: c.label })), chosen),
    )
  }

  useEffect(() => {
    const live = new Set<string | number>(items.map((r) => r.emp_code))
    setPicked((prev) => {
      const next = new Set<string | number>([...prev].filter((k) => live.has(k)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
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

      <ViewBar<SistemEmployee>
        view={view}
        onView={setView}
        density={density}
        onDensity={setDensity}
        columns={SISTEM_COLUMNS}
        groups={SISTEM_GROUPS}
        hidden={hidden}
        onHidden={(next) => setHiddenArr([...next])}
        onExport={exportCsv}
        selectedCount={picked.size}
        onClearSelection={() => setPicked(new Set())}
      />

      {view === 'tabel' ? (
        <Sheet<SistemEmployee>
          ariaLabel="Data sistem karyawan (hanya baca)"
          columns={visibleColumns}
          groups={SISTEM_GROUPS}
          rows={items}
          rowKey={(r) => r.emp_code}
          frozenKeys={['EmpName']}
          rowNumberOffset={(page - 1) * LIMIT}
          loading={loading}
          // Read-only source: no onCellCommit, so no column is editable.
          onRowOpen={(row) => setSelected(row.emp_code)}
          rowHeight={DENSITY_H[density]}
          selectable
          selectedKeys={picked}
          onSelectChange={setPicked}
          height="calc(100dvh - 14rem)"
          empty={
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
          }
        />
      ) : (
        <CardGrid<SistemEmployee>
          rows={items}
          rowKey={(r) => r.emp_code}
          title={(r) => String(r.EmpName).trim()}
          subtitle={(r) => (r.pos_name ? String(r.pos_name).trim() : r.PosCode) ?? null}
          fields={cardFields}
          onOpen={(r) => setSelected(r.emp_code)}
          loading={loading}
          selectable
          selectedKeys={picked}
          onSelectChange={setPicked}
          height="calc(100dvh - 16rem)"
          empty={
            <div className="empty">
              <p>Tidak ada karyawan sistem yang cocok.</p>
            </div>
          }
        />
      )}

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

      {selected && <SistemPopup code={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}
