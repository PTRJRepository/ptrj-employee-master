import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  api,
  nf,
  rupiah,
  shortDate,
  type Employee,
  type ListResponse,
  type MeResponse,
  type MetaResponse,
} from '../api'
import { toast } from '../toast'
import EmployeeForm, { dirtyFields, EMPTY_DRAFT, toDraft, type Draft } from '../components/EmployeeForm'

const LIMIT = 50

/* ── Add-employee modal ─────────────────────────────────────────── */
function AddModal({
  meta,
  onClose,
  onCreated,
}: {
  meta: MetaResponse
  onClose: () => void
  onCreated: () => void
}) {
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT, division: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const submit = async () => {
    const errs: Record<string, string> = {}
    if (!draft.nama.trim()) errs.nama = 'Nama wajib diisi.'
    if (!draft.division) errs.division = 'Pilih divisi karyawan.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      await api.createEmployee(draft as Partial<Employee>)
      onCreated()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan karyawan.')
      setSaving(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Tambah karyawan">
      <div className="scrim" onClick={() => !saving && onClose()} />
      <div className="modal__card">
        <div className="modal__head">
          <h2>Tambah karyawan</h2>
          <p className="page__desc">Data manual: tersimpan di EMPLOYEE_MASTER beserta catatan perubahan.</p>
        </div>
        <div className="modal__body">
          <EmployeeForm
            draft={draft}
            onChange={setDraft}
            divisions={meta.divisions.map((d) => d.division)}
            errors={errors}
            disabled={saving}
          />
        </div>
        <div className="modal__foot">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Batal
          </button>
          <button type="button" className={`btn btn--primary${saving ? ' is-loading' : ''}`} onClick={submit} disabled={saving}>
            {saving ? 'Menyimpan…' : 'Simpan karyawan'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Detail drawer (view + edit + delete) ───────────────────────── */
function DetailDrawer({
  item,
  meta,
  can,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: Employee
  meta: MetaResponse
  can: { edit: boolean; delete: boolean }
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => toDraft(item))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        if (confirmDelete) setConfirmDelete(false)
        else if (editing) setEditing(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing, saving, confirmDelete])

  const save = async () => {
    const errs: Record<string, string> = {}
    if (!draft.nama.trim()) errs.nama = 'Nama wajib diisi.'
    if (!draft.division) errs.division = 'Pilih divisi karyawan.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const patch = dirtyFields(item, draft)
    setSaving(true)
    try {
      if (Object.keys(patch).length === 0) {
        setEditing(false)
        return
      }
      await api.updateEmployee(item.id, patch)
      setEditing(false)
      onSaved() // silent success — the row itself is the feedback
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan perubahan.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    setSaving(true)
    try {
      await api.deleteEmployee(item.id)
      onDeleted()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menghapus karyawan.')
      setSaving(false)
    }
  }

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <>
      <dt>{label}</dt>
      <dd>{value ?? '–'}</dd>
    </>
  )

  return (
    <>
      <div className="scrim" onClick={() => !saving && onClose()} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Detail ${item.nama}`}>
        <div className="drawer__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="label-caps">
              {item.division}
              {item.sub_divisi ? ` · ${item.sub_divisi}` : ''}
            </span>
            <h2>{item.nama}</h2>
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Tutup detail" disabled={saving}>
            ✕
          </button>
        </div>

        <div className="drawer__body">
          {!editing ? (
            <>
              <section className="fsection">
                <h3>Kepegawaian</h3>
                <dl className="dl">
                  <Row label="Jabatan" value={item.jabatan} />
                  <Row label="Status" value={item.status} />
                  <Row label="Status (2)" value={item.status2} />
                  <Row label="LK / PR" value={item.gender} />
                  <Row label="Tgl masuk" value={shortDate(item.tanggal_masuk)} />
                  <Row label="No. KTP" value={<span className="mono">{item.no_ktp}</span>} />
                  <Row label="No. KK" value={<span className="mono">{item.no_kk}</span>} />
                  <Row label="No. rekening" value={<span className="mono">{item.no_rekening}</span>} />
                  <Row label="Catatan" value={item.catatan} />
                </dl>
              </section>
              <section className="fsection">
                <h3>Keuangan &amp; BPJS</h3>
                <dl className="dl">
                  <Row label="Gaji pokok" value={<span className="tnum">{rupiah(item.gaji_pokok)}</span>} />
                  <Row label="Tunj. masa kerja" value={<span className="tnum">{rupiah(item.tunjangan_masa_kerja)}</span>} />
                  <Row label="Gaji + tunj. tetap" value={<span className="tnum">{rupiah(item.gaji_total)}</span>} />
                  <Row label="Upah" value={<span className="tnum">{rupiah(item.upah)}</span>} />
                  <Row label="BPJS kesehatan" value={item.bpjs_kesehatan} />
                  <Row label="BPJS Jamsostek" value={item.bpjs_jamsostek} />
                </dl>
              </section>
              <section className="fsection">
                <h3>Identitas &amp; keluarga</h3>
                <dl className="dl">
                  <Row label="Tempat, tgl lahir" value={`${item.tempat_lahir ?? '–'}${item.tanggal_lahir ? `, ${shortDate(item.tanggal_lahir)}` : ''}`} />
                  <Row label="Agama" value={item.agama} />
                  <Row label="Pendidikan" value={item.pendidikan} />
                  <Row label="Alamat" value={item.alamat} />
                  <Row label="Domisili" value={item.domisili} />
                  <Row label="Nama ibu" value={item.nama_ibu} />
                  <Row label="Pasangan" value={item.nama_suami_istri} />
                  <Row label="Anak" value={item.nama_anak} />
                </dl>
              </section>
              <section className="fsection">
                <h3>Riwayat baris</h3>
                <dl className="dl">
                  <Row label="Dibuat" value={`${shortDate(item.created_at)} · ${item.created_by ?? '–'}`} />
                  <Row label="Diubah" value={`${shortDate(item.updated_at)} · ${item.updated_by ?? '–'}`} />
                </dl>
              </section>
            </>
          ) : (
            <EmployeeForm
              draft={draft}
              onChange={setDraft}
              divisions={meta.divisions.map((d) => d.division)}
              errors={errors}
              disabled={saving}
            />
          )}
        </div>

        <div className="drawer__foot">
          {!editing ? (
            <>
              {can.delete && (
                <button type="button" className="btn btn--danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  Hapus
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="btn" onClick={onClose}>
                Tutup
              </button>
              {can.edit && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setDraft(toDraft(item))
                    setEditing(true)
                  }}
                >
                  Ubah data
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>
                Batal
              </button>
              <button type="button" className={`btn btn--primary${saving ? ' is-loading' : ''}`} onClick={save} disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan perubahan'}
              </button>
            </>
          )}
        </div>

        {confirmDelete && (
          <div className="modal" role="dialog" aria-modal="true" aria-label="Konfirmasi hapus">
            <div className="scrim" onClick={() => !saving && setConfirmDelete(false)} />
            <div className="modal__card modal__card--sm">
              <div className="modal__head">
                <h2>Hapus karyawan?</h2>
              </div>
              <div className="modal__body">
                <p>
                  <b>{item.nama}</b> ({item.division}) akan dihapus permanen dari Data Manual.
                  Riwayat perubahan tetap tersimpan.
                </p>
              </div>
              <div className="modal__foot">
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)} disabled={saving}>
                  Batal
                </button>
                <button type="button" className={`btn btn--danger${saving ? ' is-loading' : ''}`} onClick={doDelete} disabled={saving}>
                  {saving ? 'Menghapus…' : 'Hapus permanen'}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

/* ── Page ───────────────────────────────────────────────────────── */
export default function Daftar({ me }: { me: MeResponse }) {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  // Local draft so typing never remounts the input (focus/caret survive the
  // debounce); synced back to ?q= via setQuery.
  const [draftQ, setDraftQ] = useState(q)
  const debounceRef = useRef(0)
  const [division, setDivision] = useState('')
  const [status, setStatus] = useState('')
  const [gender, setGender] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('division')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    setPage(1)
  }, [q])

  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const [data, setData] = useState<ListResponse<Employee> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Employee | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [flash, setFlash] = useState<Set<number>>(new Set())

  // watermark bookkeeping for live updates
  const lastWm = useRef({ total: -1, watermark: -1 })
  const stamps = useRef<Map<number, string>>(new Map())

  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const res = await api.listEmployees({ q, division, status, gender, page, limit: LIMIT, sort, dir })
      if (seq !== loadSeq.current) return // a newer request superseded this one
      setData(res)
      setError('')
      // Deleting the last row of a page leaves us past the end: fall back.
      if (res.items.length === 0 && page > 1) setPage((p) => Math.max(1, p - 1))
      // track row stamps for change flash
      const next = new Map<number, string>()
      const changed = new Set<number>()
      for (const row of res.items) {
        next.set(row.id, row.updated_at)
        const prev = stamps.current.get(row.id)
        if (prev !== undefined && prev !== row.updated_at) changed.add(row.id)
      }
      stamps.current = next
      if (changed.size) {
        setFlash(changed)
        window.setTimeout(() => setFlash(new Set()), 1700)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat data')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [q, division, status, gender, page, sort, dir])

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch(() =>
        toast.error('Gagal memuat metadata divisi. Tambah/Ubah dinonaktifkan, coba muat ulang.'),
      )
  }, [])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // poll the cheap watermark endpoint every 5s; reload list only on change
  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const wm = await api.watermark()
        if (wm.total !== lastWm.current.total || wm.watermark !== lastWm.current.watermark) {
          lastWm.current = wm
          load()
        }
      } catch {
        /* transient — next tick retries */
      }
    }, 5000)
    return () => window.clearInterval(id)
  }, [load])

  const setQuery = (nextQ: string) => {
    const p = new URLSearchParams(params)
    if (nextQ) p.set('q', nextQ)
    else p.delete('q')
    setParams(p, { replace: true })
    setPage(1)
  }

  const toggleSort = (col: string) => {
    if (sort === col) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(col)
      setDir('asc')
    }
    setPage(1)
  }

  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Data Manual</h1>
          <p className="page__desc">
            Master karyawan hasil impor Excel, bisa diedit siapa pun dengan izin tulis.
            Perubahan tercatat di riwayat.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <Link className="btn" to="/sistem">
            Data Sistem (baca)
          </Link>
          {me.can.edit && (
            <button type="button" className="btn btn--primary" onClick={() => setAddOpen(true)}>
              + Tambah karyawan
            </button>
          )}
        </div>
      </div>

      <div className="toolbar">
        <div className="searchpill" style={{ maxWidth: '20rem' }}>
          <span aria-hidden="true" className="label-caps" style={{ color: 'var(--color-neutral)' }}>
            Cari
          </span>
          <input
            type="search"
            value={draftQ}
            placeholder="Nama, KTP, jabatan…"
            aria-label="Cari dalam data manual"
            onChange={(e) => {
              const v = e.target.value
              setDraftQ(v)
              window.clearTimeout(debounceRef.current)
              debounceRef.current = window.setTimeout(() => setQuery(v), 250)
            }}
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={division} aria-label="Filter divisi" onChange={(e) => { setDivision(e.target.value); setPage(1) }}>
          <option value="">Semua divisi</option>
          {(meta?.divisions ?? []).map((d) => (
            <option key={d.division} value={d.division}>
              {d.division} ({d.count})
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={status} aria-label="Filter status" onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
          <option value="">Semua status</option>
          {(meta?.statuses ?? []).map((s) => (
            <option key={s.status} value={s.status}>
              {s.status} ({s.count})
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={gender} aria-label="Filter LK/PR" onChange={(e) => { setGender(e.target.value); setPage(1) }}>
          <option value="">LK &amp; PR</option>
          <option value="LK">LK</option>
          <option value="PR">PR</option>
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
              <th style={{ width: '3.5rem' }}>No.</th>
              <th>
                <button type="button" onClick={() => toggleSort('nama')} aria-label="Urutkan nama">
                  Nama {sort === 'nama' ? (dir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th>
                <button type="button" onClick={() => toggleSort('division')} aria-label="Urutkan divisi">
                  Divisi {sort === 'division' ? (dir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th>Status</th>
              <th>JK</th>
              <th>
                <button type="button" onClick={() => toggleSort('tanggal_masuk')} aria-label="Urutkan tanggal masuk">
                  Tgl masuk {sort === 'tanggal_masuk' ? (dir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th>No. KTP</th>
              <th style={{ textAlign: 'end' }}>
                <button type="button" onClick={() => toggleSort('gaji_pokok')} aria-label="Urutkan gaji pokok">
                  Gaji pokok {sort === 'gaji_pokok' ? (dir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th>Domisili</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  <td colSpan={9}>
                    <div className="skel" style={{ width: `${90 - i * 6}%` }} />
                  </td>
                </tr>
              ))}
            {!loading &&
              (data?.items ?? []).map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  className={flash.has(row.id) ? 'flash' : undefined}
                  onClick={() => setSelected(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelected(row)
                    }
                  }}
                >
                  <td className="num">{row.no ?? '–'}</td>
                  <td>
                    <span className="cell-name">{row.nama}</span>
                    {row.jabatan && <span className="cell-sub">{row.jabatan}</span>}
                  </td>
                  <td>
                    <span className="tag">{row.division}</span>
                    {row.sub_divisi && <span className="cell-sub">{row.sub_divisi}</span>}
                  </td>
                  <td>
                    <span className="tag tag--muted">{row.status ?? '–'}</span>
                  </td>
                  <td>{row.gender ?? '–'}</td>
                  <td className="tnum">{shortDate(row.tanggal_masuk)}</td>
                  <td className="mono">{row.no_ktp ?? '–'}</td>
                  <td className="num">{rupiah(row.gaji_pokok)}</td>
                  <td>{row.domisili ?? '–'}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && (data?.items.length ?? 0) === 0 && (
          <div className="empty">
            <span className="empty__mark" aria-hidden="true">
              ⌕
            </span>
            <p>Tidak ada karyawan yang cocok.</p>
            <p>Ubah kata kunci atau filter divisi untuk memperluas pencarian.</p>
            {(q || division || status || gender) && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setQuery('')
                  setDivision('')
                  setStatus('')
                  setGender('')
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

      {selected && meta && (
        <DetailDrawer
          item={selected}
          meta={meta}
          can={{ edit: me.can.edit, delete: me.can.delete }}
          onClose={() => setSelected(null)}
          onSaved={() => {
            load()
            // refresh the selected snapshot in place
            api.getEmployee(selected.id).then((r) => setSelected(r.item)).catch(() => {})
          }}
          onDeleted={() => load()}
        />
      )}

      {addOpen && meta && (
        <AddModal
          meta={meta}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setPage(1)
            load()
          }}
        />
      )}
    </main>
  )
}
