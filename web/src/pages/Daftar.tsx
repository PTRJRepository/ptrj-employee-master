import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type SchemaColumn,
  type SchemaGroup,
} from '../api'
import { toast } from '../toast'
import EmployeeForm, { dirtyFields, EMPTY_DRAFT, toDraft, type Draft } from '../components/EmployeeForm'
import Sheet, { type SheetColumn } from '../components/Sheet'
import CardGrid, { type CardField } from '../components/CardGrid'
import ViewBar, { DENSITY_H, type Density, type ViewMode } from '../components/ViewBar'
import { usePersisted } from '../lib/prefs'
import { downloadCsv, stampedName, toCsv } from '../lib/csv'

/**
 * Rows fetched per page. The grid windows client-side, so a larger page means
 * more of the table is reachable in one scroll without extra requests. The API
 * clamps `limit` to 500 (intParam(query.limit, 50, 500) in src/routes/manual.ts),
 * so 250 is comfortably inside the cap.
 */
const LIMIT = 250

/** Coerce a grid edit to the type the column declares before it is PATCHed. */
function coerceForPatch(kind: SchemaColumn['kind'], value: string): string | number | null {
  if (kind === 'money' || kind === 'int') {
    const digits = value.replace(/[^\d.-]/g, '')
    if (digits === '' || digits === '-' || digits === '.') return null
    const n = Number(digits)
    return Number.isFinite(n) ? n : null
  }
  return value.trim() === '' ? null : value
}

/** Build the <Sheet> column model from the server schema, once. */
function buildSheetColumns(schema: SchemaColumn[]): SheetColumn<Employee>[] {
  return schema.map((c) => {
    const base: SheetColumn<Employee> = {
      key: c.key,
      label: c.label,
      group: c.group,
      type: c.kind,
      width: c.width,
      align: c.align,
      editable: c.editable,
      source: c.source,
      raw: (row) => (row as unknown as Record<string, string | number | null>)[c.key],
    }
    // Preserve the badges the old hand-written table rendered.
    if (c.key === 'nama') {
      base.render = (row: Employee) => <span className="cell-name">{row.nama}</span>
    } else if (c.key === 'division') {
      base.render = (row: Employee) => <span className="tag">{row.division}</span>
    } else if (c.key === 'status') {
      base.render = (row: Employee) => <span className="tag tag--muted">{row.status ?? '–'}</span>
    }
    return base
  })
}

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

/* ── Detail popup (view + edit + delete) ───────────────────────── */
function DetailPopup({
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
  const [wide, setWide] = useState(false)

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
    <div className="popup-overlay" onClick={() => !saving && onClose()}>
      <div
        className={`popup${wide ? ' popup--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Detail ${item.nama}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <span className="label-caps">
              {item.division}
              {item.sub_divisi ? ` · ${item.sub_divisi}` : ''}
            </span>
            <h2>{item.nama}</h2>
          </div>
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
            <button type="button" className="iconbtn" onClick={onClose} aria-label="Tutup detail" disabled={saving}>
              ✕
            </button>
          </div>
        </div>

        <div className="popup__body">
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

        <div className="popup__foot">
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
      </div>
    </div>
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
  const [schema, setSchema] = useState<SchemaColumn[]>([])
  const [schemaGroups, setSchemaGroups] = useState<SchemaGroup[]>([])

  /* ── Working preferences (persisted; they belong to the operator) ── */
  const [view, setView] = usePersisted<ViewMode>('daftar.view', 'tabel')
  const [density, setDensity] = usePersisted<Density>('daftar.density', 'rapat')
  const [hiddenArr, setHiddenArr] = usePersisted<string[]>('daftar.hidden', [])
  const hidden = useMemo(() => new Set(hiddenArr), [hiddenArr])

  /* ── Selection for bulk actions and export ── */
  const [picked, setPicked] = useState<Set<string | number>>(new Set())

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

  // Column model for the grid. Fetched once; static on the server.
  useEffect(() => {
    api
      .schema()
      .then((s) => {
        setSchema(s.columns)
        setSchemaGroups(s.groups)
      })
      .catch(() => toast.error('Gagal memuat skema kolom. Grid ditampilkan sebagian.'))
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

  /** Commit one edited cell (inline grid edit). */
  const saveCell = async (row: Employee, key: string, value: string) => {
    const col = schema.find((c) => c.key === key)
    if (!col || col.source === 'audit' || !col.editable) return
    try {
      await api.updateEmployee(row.id, { [key]: coerceForPatch(col.kind, value) })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan perubahan.')
    }
  }

  const total = data?.total ?? 0
  const items = data?.items ?? []

  /* Columns actually shown: schema order minus the ones the operator hid.
     Frozen keys are never hidden (the picker says so), so filter them out. */
  const visibleColumns = useMemo(
    () => buildSheetColumns(schema).filter((c) => !hidden.has(c.key)),
    [schema, hidden],
  )

  /** Card body: the identity essentials first, the rest behind "expand". */
  const CARD_MAIN: Array<[string, string]> = [
    ['jabatan', 'Jabatan'],
    ['division', 'Divisi'],
    ['status', 'Status'],
    ['tanggal_masuk', 'Tgl masuk'],
    ['gaji_pokok', 'Gaji pokok'],
  ]
  const CARD_DETAIL: Array<[string, string]> = [
    ['no_ktp', 'No. KTP'],
    ['tempat_lahir', 'Tempat lahir'],
    ['tanggal_lahir', 'Tgl lahir'],
    ['agama', 'Agama'],
    ['pendidikan', 'Pendidikan'],
    ['no_rekening', 'No. rekening'],
    ['no_bpjs_tk', 'No. BPJS TK'],
    ['domisili', 'Domisili'],
    ['alamat', 'Alamat'],
    ['nama_suami_istri', 'Pasangan'],
    ['nama_ibu', 'Nama ibu'],
    ['nama_anak', 'Nama anak'],
  ]
  const idOf = (r: Employee) => r as unknown as Record<string, unknown>
  const cardFields = (r: Employee): CardField[] => {
    const src = idOf(r)
    const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v))
    const out: CardField[] = []
    for (const [k, label] of CARD_MAIN) {
      const raw = src[k]
      if (raw === null || raw === undefined || raw === '') continue
      out.push({
        key: k,
        label,
        value: k === 'gaji_pokok' ? rupiah(raw as number) : k === 'tanggal_masuk' ? shortDate(String(raw)) : shown(raw),
        numeric: k === 'gaji_pokok',
        tone: k === 'division' ? 'accent' : k === 'status' ? 'muted' : 'plain',
      })
    }
    for (const [k, label] of CARD_DETAIL) {
      const v = shown(src[k])
      if (!v) continue
      out.push({
        key: k,
        label,
        value: k === 'tanggal_lahir' ? shortDate(v) : v,
        detail: true,
      })
    }
    return out
  }

  /** Export the visible columns for the selected rows (or the whole page). */
  const exportCsv = () => {
    const chosen = picked.size ? items.filter((r) => picked.has(r.id)) : items
    const cols = visibleColumns.map((c) => ({ key: c.key, label: c.label }))
    downloadCsv(stampedName('data-manual'), toCsv(cols, chosen))
  }

  // A row deleted or filtered away must not linger in the selection count.
  useEffect(() => {
    const live = new Set<string | number>(items.map((r) => r.id))
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

      <ViewBar<Employee>
        view={view}
        onView={setView}
        density={density}
        onDensity={setDensity}
        columns={buildSheetColumns(schema)}
        groups={schemaGroups}
        hidden={hidden}
        onHidden={(next) => setHiddenArr([...next])}
        onExport={exportCsv}
        selectedCount={picked.size}
        onClearSelection={() => setPicked(new Set())}
      />

      {view === 'tabel' ? (
        <Sheet<Employee>
          ariaLabel="Data manual karyawan"
          columns={visibleColumns}
          groups={schemaGroups}
          rows={items}
          rowKey={(r) => r.id}
          // The two columns that identify a payroll row stay pinned while the
          // remaining 27 scroll horizontally.
          frozenKeys={['nama']}
          rowNumberOffset={(page - 1) * LIMIT}
          loading={loading}
          flashKeys={flash}
          sortKey={sort}
          sortDir={dir}
          onSort={toggleSort}
          onRowOpen={(row) => setSelected(row)}
          onCellCommit={saveCell}
          rowHeight={DENSITY_H[density]}
          selectable
          selectedKeys={picked}
          onSelectChange={setPicked}
          empty={
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
          }
        />
      ) : (
        <CardGrid<Employee>
          rows={items}
          rowKey={(r) => r.id}
          title={(r) => r.nama}
          subtitle={(r) => r.jabatan ?? null}
          fields={cardFields}
          onOpen={(r) => setSelected(r)}
          loading={loading}
          flashKeys={flash}
          selectable
          selectedKeys={picked}
          onSelectChange={setPicked}
          empty={
            <div className="empty">
              <p>Tidak ada karyawan yang cocok.</p>
              <p>Ubah kata kunci atau filter untuk memperluas pencarian.</p>
            </div>
          }
        />
      )}

      <div className="statusbar">
        <span className="status-item">
          <span className="dot"></span>
          Siap
        </span>
        <span className="status-item">
          Total: <strong>{nf.format(total)}</strong> karyawan
        </span>
        <span className="status-item">
          Halaman: <strong>{page}</strong> / {totalPages}
        </span>
        <span style={{ flex: 1 }} />
        <span className="status-item">
          Klik baris untuk detail · Enter untuk membuka
        </span>
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
        <DetailPopup
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
