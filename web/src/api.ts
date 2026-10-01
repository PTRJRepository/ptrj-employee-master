/**
 * src/api.ts — typed fetch client for the employee-master API.
 * All calls are same-origin under the module mount (/employee-master/api).
 */

const BASE = '/employee-master/api'

export interface Employee {
  id: number
  division: string
  sub_divisi: string | null
  no: number | null
  nama: string
  status: string | null
  status2: string | null
  gender: string | null
  jabatan: string | null
  catatan: string | null
  tanggal_masuk: string | null
  tanggal_lahir: string | null
  tempat_lahir: string | null
  no_ktp: string | null
  no_kk: string | null
  no_rekening: string | null
  no_bpjs_tk: string | null
  gaji_pokok: number | null
  tunjangan_masa_kerja: number | null
  gaji_total: number | null
  upah: number | null
  bpjs_kesehatan: string | null
  bpjs_jamsostek: string | null
  nama_ibu: string | null
  nama_suami_istri: string | null
  nama_anak: string | null
  agama: string | null
  pendidikan: string | null
  alamat: string | null
  domisili: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface ChangeRow {
  id: number
  employee_id: number
  employee_name: string | null
  action: string
  field: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
}

export interface Identity {
  userId: number | string
  name: string
  email: string
  role: string
}

export interface MeResponse {
  success: boolean
  user: Identity
  can: { edit: boolean; delete: boolean }
}

export interface ListResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface MetaResponse {
  divisions: Array<{ division: string; count: number }>
  statuses: Array<{ status: string; count: number }>
  total: number
  watermark: number
}

export interface DashboardResponse {
  total: number
  lk: number
  pr: number
  new30: number
  watermark: number
  byGender: Array<{ gender: string; count: number }>
  byDivision: Array<{ division: string; count: number }>
  recentChanges: ChangeRow[]
}

export interface SistemEmployee {
  emp_code: string
  EmpName: string
  Gender: string
  gender_label: string
  NewICNo: string | null
  DOB: string | null
  Religion: string | null
  Status: string
  MobileTel: string | null
  ResAddress: string | null
  PlaceOfBirth: string | null
  AppJoinDate: string | null
  TerminateDate: string | null
  DeptCode: string | null
  dept_name: string | null
  PosCode: string | null
  pos_name: string | null
  LocCode: string | null
  GangCode: string | null
  LevelCode: string | null
  is_active: number
}

export interface SistemFamily {
  FamilyID: number
  FamName: string
  Gender: string
  Relationship: string
  DOB: string | null
  TelNo: string | null
  Remark: string | null
}

export interface DeptRow {
  dept_code: string
  dept_name: string
  Status: string
  headcount: number
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (res.status === 401) {
    // Session gone → module root login page (NOT current-route + /login).
    window.location.href = '/employee-master/login'
    throw new ApiError(401, 'Sesi berakhir')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(res.status, String(body.error ?? `HTTP ${res.status}`))
  }
  return body as T
}

export const api = {
  me: () => request<MeResponse>('/auth/me'),
  meta: () => request<MetaResponse>('/meta'),
  dashboard: () => request<DashboardResponse>('/dashboard'),
  watermark: () => request<{ total: number; watermark: number }>('/employees/watermark'),

  listEmployees: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    }
    return request<ListResponse<Employee>>(`/employees?${qs}`)
  },
  getEmployee: (id: number) => request<{ item: Employee }>(`/employees/${id}`),
  createEmployee: (payload: Partial<Employee>) =>
    request<{ success: boolean; id: number }>('/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEmployee: (id: number, payload: Partial<Employee>) =>
    request<{ success: boolean; item: Employee; changed: number }>(`/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteEmployee: (id: number) =>
    request<{ success: boolean }>(`/employees/${id}`, { method: 'DELETE' }),

  changes: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    }
    return request<{ items: ChangeRow[] }>(`/changes?${qs}`)
  },

  sistemList: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    }
    return request<ListResponse<SistemEmployee>>(`/sistem/employees?${qs}`)
  },
  sistemDetail: (code: string) =>
    request<{ item: SistemEmployee; family: SistemFamily[] }>(
      `/sistem/employees/${encodeURIComponent(code)}`,
    ),
  sistemDepts: () => request<{ items: DeptRow[] }>('/sistem/depts'),
}

/* ── Formatting helpers (Indonesian locale) ─────────────────────── */

export const nf = new Intl.NumberFormat('id-ID')

export function rupiah(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–'
  return new Intl.NumberFormat('id-ID').format(v)
}

export function shortDate(v: string | null | undefined): string {
  if (!v) return '–'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function agoTime(v: string): string {
  const d = new Date(v)
  const diff = Math.max(0, Date.now() - d.getTime())
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'baru saja'
  if (m < 60) return `${m} mnt lalu`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} jam lalu`
  const dd = Math.floor(h / 24)
  if (dd < 30) return `${dd} hari lalu`
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Field labels for audit trail + form headers (Indonesian). */
export const FIELD_LABELS: Record<string, string> = {
  division: 'Divisi',
  sub_divisi: 'Sub-divisi',
  no: 'No.',
  nama: 'Nama',
  status: 'Status',
  status2: 'Status (2)',
  gender: 'LK/PR',
  jabatan: 'Jabatan',
  catatan: 'Catatan',
  tanggal_masuk: 'Tgl masuk',
  tanggal_lahir: 'Tgl lahir',
  tempat_lahir: 'Tempat lahir',
  no_ktp: 'No. KTP',
  no_kk: 'No. KK',
  no_rekening: 'No. rekening',
  no_bpjs_tk: 'No. BPJS TK',
  gaji_pokok: 'Gaji pokok',
  tunjangan_masa_kerja: 'Tunjangan masa kerja',
  gaji_total: 'Gaji + tunjangan tetap',
  upah: 'Upah',
  bpjs_kesehatan: 'BPJS kesehatan',
  bpjs_jamsostek: 'BPJS Jamsostek',
  nama_ibu: 'Nama ibu',
  nama_suami_istri: 'Nama pasangan',
  nama_anak: 'Nama anak',
  agama: 'Agama',
  pendidikan: 'Pendidikan',
  alamat: 'Alamat',
  domisili: 'Domisili',
}

export function actionLabel(action: string): string {
  if (action === 'create') return 'menambahkan'
  if (action === 'delete') return 'menghapus'
  return 'mengubah'
}
