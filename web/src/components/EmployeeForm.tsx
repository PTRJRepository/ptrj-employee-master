import type { Employee } from '../api'

/**
 * EmployeeForm — the add/edit form body, grouped like the source workbook.
 * `draft` holds strings for every field (money as raw digits, dates as
 * yyyy-mm-dd); the caller converts + validates on save.
 */
export type Draft = Record<string, string>

export const EMPTY_DRAFT: Draft = {
  nama: '',
  division: '',
  sub_divisi: '',
  jabatan: '',
  status: '',
  status2: '',
  gender: '',
  catatan: '',
  tanggal_masuk: '',
  tanggal_lahir: '',
  tempat_lahir: '',
  no_ktp: '',
  no_kk: '',
  no_rekening: '',
  no_bpjs_tk: '',
  gaji_pokok: '',
  tunjangan_masa_kerja: '',
  gaji_total: '',
  upah: '',
  bpjs_kesehatan: '',
  bpjs_jamsostek: '',
  nama_ibu: '',
  nama_suami_istri: '',
  nama_anak: '',
  agama: '',
  pendidikan: '',
  alamat: '',
  domisili: '',
}

export function toDraft(e: Employee): Draft {
  const d: Draft = { ...EMPTY_DRAFT }
  for (const [k, v] of Object.entries(e)) {
    if (k in d) {
      if (v === null || v === undefined) d[k] = ''
      else if (typeof v === 'number') d[k] = String(v)
      else if (typeof v === 'string') d[k] = v
    }
  }
  // dates → yyyy-mm-dd for <input type="date">
  d.tanggal_masuk = (d.tanggal_masuk || '').slice(0, 10)
  d.tanggal_lahir = (d.tanggal_lahir || '').slice(0, 10)
  return d
}

export function dirtyFields(original: Employee, draft: Draft): Partial<Employee> {
  const before = toDraft(original)
  const patch: Record<string, unknown> = {}
  const MONEY = new Set(['gaji_pokok', 'tunjangan_masa_kerja', 'gaji_total', 'upah'])
  for (const [k, now] of Object.entries(draft)) {
    if (before[k] === now) continue
    if (MONEY.has(k)) {
      const a = before[k].replace(/\D/g, '')
      const b = now.replace(/\D/g, '')
      if (a === b) continue
      patch[k] = b === '' ? null : Number(b)
      continue
    }
    if (k === 'tanggal_masuk' || k === 'tanggal_lahir') {
      patch[k] = now || null
      continue
    }
    patch[k] = now.trim() === '' ? null : now.trim()
  }
  return patch as Partial<Employee>
}

interface Props {
  draft: Draft
  onChange: (next: Draft) => void
  divisions: string[]
  errors: Record<string, string>
  disabled?: boolean
}

function Field(props: {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  span2?: boolean
  placeholder?: string
  inputMode?: 'numeric' | 'text'
  type?: string
}) {
  const id = `f-${props.name}`
  const errId = `${id}-err`
  return (
    <div className={`field${props.error ? ' is-error' : ''}${props.span2 ? ' span2' : ''}`}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className="input"
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        value={props.value}
        placeholder={props.placeholder}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={props.error ? errId : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <span className="field__help" id={errId}>
        {props.error ?? ''}
      </span>
    </div>
  )
}

export default function EmployeeForm({ draft, onChange, divisions, errors, disabled }: Props) {
  const set = (k: string) => (v: string) => onChange({ ...draft, [k]: v })

  return (
    <>
      <section className="fsection">
        <h3>Identitas</h3>
        <div className="fgrid">
          <Field name="nama" label="Nama lengkap *" value={draft.nama} onChange={set('nama')} error={errors.nama} placeholder="Huruf besar semua, sesuai KTP" />
          <div className={`field${errors.division ? ' is-error' : ''}`}>
            <label htmlFor="f-division">Divisi *</label>
            <select
              id="f-division"
              className="select"
              value={draft.division}
              disabled={disabled}
              aria-invalid={errors.division ? 'true' : undefined}
              onChange={(e) => onChange({ ...draft, division: e.target.value })}
            >
              <option value="">Pilih divisi</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="field__help">{errors.division ?? ''}</span>
          </div>
          <Field name="jabatan" label="Jabatan" value={draft.jabatan} onChange={set('jabatan')} />
          <Field name="sub_divisi" label="Sub-divisi" value={draft.sub_divisi} onChange={set('sub_divisi')} />
          <Field name="status" label="Status (TK/K)" value={draft.status} onChange={set('status')} placeholder="TK0, K1, K2…" />
          <Field name="status2" label="Status (2)" value={draft.status2} onChange={set('status2')} />
          <div className="field">
            <label htmlFor="f-gender">LK / PR</label>
            <select id="f-gender" className="select" value={draft.gender} onChange={(e) => onChange({ ...draft, gender: e.target.value })}>
              <option value="">–</option>
              <option value="LK">LK (laki-laki)</option>
              <option value="PR">PR (perempuan)</option>
            </select>
            <span className="field__help" />
          </div>
          <Field name="agama" label="Agama" value={draft.agama} onChange={set('agama')} />
        </div>
      </section>

      <section className="fsection">
        <h3>Kelahiran &amp; alamat</h3>
        <div className="fgrid">
          <Field name="tempat_lahir" label="Tempat lahir" value={draft.tempat_lahir} onChange={set('tempat_lahir')} />
          <Field name="tanggal_lahir" label="Tanggal lahir" type="date" value={draft.tanggal_lahir} onChange={set('tanggal_lahir')} />
          <Field name="pendidikan" label="Pendidikan" value={draft.pendidikan} onChange={set('pendidikan')} />
          <Field name="domisili" label="Domisili" value={draft.domisili} onChange={set('domisili')} />
          <Field name="alamat" label="Alamat" value={draft.alamat} onChange={set('alamat')} span2 />
        </div>
      </section>

      <section className="fsection">
        <h3>Kepegawaian</h3>
        <div className="fgrid">
          <Field name="tanggal_masuk" label="Tanggal masuk" type="date" value={draft.tanggal_masuk} onChange={set('tanggal_masuk')} />
          <Field name="no_ktp" label="No. KTP" value={draft.no_ktp} onChange={set('no_ktp')} inputMode="numeric" />
          <Field name="no_kk" label="No. KK" value={draft.no_kk} onChange={set('no_kk')} inputMode="numeric" />
          <Field name="no_rekening" label="No. rekening" value={draft.no_rekening} onChange={set('no_rekening')} inputMode="numeric" />
          <Field name="no_bpjs_tk" label="No. BPJS TK" value={draft.no_bpjs_tk} onChange={set('no_bpjs_tk')} inputMode="numeric" />
          <div className="field span2">
            <label htmlFor="f-catatan">Catatan</label>
            <textarea
              id="f-catatan"
              className="input"
              value={draft.catatan}
              onChange={(e) => onChange({ ...draft, catatan: e.target.value })}
            />
            <span className="field__help">Mutasi, promosi, keterangan lain</span>
          </div>
        </div>
      </section>

      <section className="fsection">
        <h3>Keuangan &amp; BPJS</h3>
        <div className="fgrid">
          <Field name="gaji_pokok" label="Gaji pokok" value={draft.gaji_pokok} onChange={set('gaji_pokok')} inputMode="numeric" placeholder="4035000" />
          <Field name="tunjangan_masa_kerja" label="Tunjangan masa kerja" value={draft.tunjangan_masa_kerja} onChange={set('tunjangan_masa_kerja')} inputMode="numeric" />
          <Field name="gaji_total" label="Gaji + tunjangan tetap" value={draft.gaji_total} onChange={set('gaji_total')} inputMode="numeric" />
          <Field name="upah" label="Upah" value={draft.upah} onChange={set('upah')} inputMode="numeric" />
          <Field name="bpjs_kesehatan" label="BPJS kesehatan" value={draft.bpjs_kesehatan} onChange={set('bpjs_kesehatan')} />
          <Field name="bpjs_jamsostek" label="BPJS Jamsostek" value={draft.bpjs_jamsostek} onChange={set('bpjs_jamsostek')} />
        </div>
      </section>

      <section className="fsection">
        <h3>Keluarga</h3>
        <div className="fgrid">
          <Field name="nama_ibu" label="Nama ibu" value={draft.nama_ibu} onChange={set('nama_ibu')} />
          <Field name="nama_suami_istri" label="Nama pasangan" value={draft.nama_suami_istri} onChange={set('nama_suami_istri')} />
          <Field name="nama_anak" label="Nama anak" value={draft.nama_anak} onChange={set('nama_anak')} span2 placeholder="Pisahkan dengan koma" />
        </div>
      </section>
    </>
  )
}
