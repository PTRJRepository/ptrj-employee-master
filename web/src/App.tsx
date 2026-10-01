import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type MeResponse } from './api'
import { toast, type ToastItem } from './toast'
import Ringkasan from './pages/Ringkasan'
import Daftar from './pages/Daftar'
import Sistem from './pages/Sistem'
import Riwayat from './pages/Riwayat'

/* ── Toast host ─────────────────────────────────────────────────── */
function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => toast.subscribe(setItems), [])
  if (!items.length) return null
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'error' ? ' toast--error' : ''}`} role="status">
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action?.run()
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── Global search pill (N13) — the find-records entry point ────── */
function SearchPill() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')

  // keep pill in sync when navigation changes ?q=
  useEffect(() => {
    setValue(params.get('q') ?? '')
  }, [params])

  return (
    <form
      className="searchpill"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        navigate(value.trim() ? `/daftar?q=${encodeURIComponent(value.trim())}` : '/daftar')
      }}
    >
      <span aria-hidden="true" className="label-caps" style={{ color: 'var(--color-neutral)' }}>
        Cari
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Nama, KTP, jabatan…"
        aria-label="Cari karyawan"
      />
      <kbd>Enter</kbd>
    </form>
  )
}

/* ── Shell: side rail + top bar + status strip ──────────────────── */
function Shell({ me }: { me: MeResponse }) {
  const initials = (me.user.name || me.user.email || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail__brand">
          <span className="rail__mark">
            Portal <span>Karyawan</span>
          </span>
          <span className="rail__sub">PT Rebinmas Jaya</span>
        </div>
        <nav className="rail__nav" aria-label="Navigasi utama">
          <NavLink to="/" end className="rail__link">
            <span className="rail__dot" aria-hidden="true" />
            Ringkasan
          </NavLink>
          <NavLink to="/daftar" className="rail__link">
            <span className="rail__dot" aria-hidden="true" />
            Data Manual
          </NavLink>
          <NavLink to="/sistem" className="rail__link">
            <span className="rail__dot" aria-hidden="true" />
            Data Sistem
          </NavLink>
          <NavLink to="/riwayat" className="rail__link">
            <span className="rail__dot" aria-hidden="true" />
            Riwayat
          </NavLink>
        </nav>
        <div className="rail__foot">
          <span className="label-caps">Sesi</span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', overflowWrap: 'anywhere' }}>
            {me.user.name || me.user.email}
          </span>
          <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
            {me.user.role || '–'}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ justifyContent: 'flex-start', paddingInline: 0, marginTop: 'var(--space-xs)' }}
            onClick={async () => {
              await fetch('/employee-master/api/auth/logout', { method: 'POST' }).catch(() => {})
              window.location.href = '/employee-master/login'
            }}
          >
            Keluar
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar__title">Master Informasi Karyawan</span>
          <SearchPill />
          <div className="topbar__user">
            <span className="live" title="Pembaruan otomatis setiap 5 detik">
              live
            </span>
            <span className="topbar__name">{me.user.name || me.user.email}</span>
            <span className="topbar__avatar" aria-hidden="true">
              {initials}
            </span>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Ringkasan me={me} />} />
          <Route path="/daftar" element={<Daftar me={me} />} />
          <Route path="/sistem" element={<Sistem />} />
          <Route path="/riwayat" element={<Riwayat />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <footer className="statusstrip">
          <span>
            Sumber <b>Data Manual</b>: extend_db_ptrj.EMPLOYEE_MASTER (bisa diedit)
          </span>
          <span>
            Sumber <b>Data Sistem</b>: db_ptrj.HR_* (hanya baca)
          </span>
          <span> employee-master · port 8018</span>
        </footer>
      </div>
      <Toasts />
    </div>
  )
}

/* ── App root ───────────────────────────────────────────────────── */
export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      setMe(await api.me())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (failed) {
    return (
      <div className="empty" style={{ minHeight: '60dvh', justifyContent: 'center' }}>
        <p>Gagal memuat sesi. Muat ulang halaman, atau hubungi admin bila berlanjut.</p>
      </div>
    )
  }
  if (!me) {
    return (
      <div className="empty" style={{ minHeight: '60dvh', justifyContent: 'center' }}>
        <div className="skel" style={{ width: 200 }} />
        <p>Memuat…</p>
      </div>
    )
  }
  return <Shell me={me} />
}
