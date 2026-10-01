/* =====================================================================
 * src/lib/auth/flow.ts
 * -----------------------------------------------------------------------------
 * Auth traffic layer for the Employee Master (HRD) module: sign-in page,
 * login/logout/me endpoints, and the entry gate for everything else.
 * Called from the request handler for EVERY request before routing;
 * returns a Response when this call fully handles the request, or null
 * to continue into the protected app.
 *
 * Sign-in uses shared/authkit login.js — same MSSQL user store (extend_db_ptrj
 * user_ptrj), same RS256 keys as the portal, so the issued `auth-token`
 * cookie is valid at the gateway, other modules, and here (single identity).
 * =====================================================================
 */
import { sessionCookie, clearSessionCookie } from '../authkit/session.js'
import { loginWithCredentials } from '../authkit/login.js'
import {
  MODULE_PREFIX,
  KEYS_DIR,
  getIdentity,
  canEnter,
  canEdit,
  canDelete,
  isPublicPath,
  type Identity,
} from './guard.js'

/** Small JSON helper with uniform envelope. */
function json(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(extraHeaders ?? {}) },
  })
}

/** Absolute-path redirect (Response.redirect demands absolute URLs). */
function redirectTo(req: Request, path: string): Response {
  return Response.redirect(new URL(path, req.url).toString(), 302)
}

/**
 * Entry point wired into Bun.serve fetch. `path` is the PREFIX-STRIPPED
 * internal path; `behindPrefix` tells whether the browser URL carries
 * MODULE_PREFIX (gateway mode / canonical direct-port form) so redirects
 * keep the user inside the mounted prefix.
 */
export async function handleAuthTraffic(
  req: Request,
  path: string,
  behindPrefix: boolean,
  wantsHtml: boolean,
  isLoopback: boolean,
): Promise<Response | null> {
  const prefix = behindPrefix ? MODULE_PREFIX : ''

  // ── Sign-in page ────────────────────────────────────────────────────────
  if (path === '/login') {
    const user = getIdentity(req, isLoopback)
    if (canEnter(user)) return redirectTo(req, `${MODULE_PREFIX}/`) // already in
    return new Response(loginPageHtml(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  // ── Auth API ────────────────────────────────────────────────────────────
  if (path === '/api/auth/login' && req.method === 'POST') return await doLogin(req)
  if (path === '/api/auth/logout' && req.method === 'POST') {
    return json(200, { success: true }, { 'set-cookie': clearSessionCookie() })
  }
  if (path === '/api/auth/me' && req.method === 'GET') {
    const user = getIdentity(req, isLoopback)
    if (!user) return json(401, { success: false, error: 'Unauthorized' })
    if (!canEnter(user)) return json(403, { success: false, error: 'Forbidden: role Anda tidak diizinkan' })
    return json(200, {
      success: true,
      user,
      can: { edit: canEdit(user), delete: canDelete(user) },
    })
  }

  // Health probe & friends pass through unauthenticated.
  if (isPublicPath(path)) return null

  // ── Gate: everything below requires an allowed portal session ──────────
  const user = getIdentity(req, isLoopback)
  if (!user) {
    return wantsHtml ? redirectTo(req, `${prefix}/login`) : json(401, { success: false, error: 'Unauthorized: sesi tidak ditemukan' })
  }
  if (!canEnter(user)) {
    return wantsHtml ? forbiddenPage(user, prefix) : json(403, { success: false, error: 'Forbidden: role Anda tidak diizinkan' })
  }
  return null // proceed into the protected app
}

/** Credential sign-in → portal-compatible RS256 cookie (allowed roles only). */
async function doLogin(req: Request): Promise<Response> {
  const raw: unknown = await req.json().catch(() => ({}))
  const body = (raw ?? {}) as Record<string, unknown>
  const username = String(body.username ?? '').trim()
  const password = String(body.password ?? '')
  const result = await loginWithCredentials({ username, password, keysDir: KEYS_DIR })
  if (!result.ok || !result.token) {
    return json(result.status ?? 401, { success: false, error: result.error ?? 'Login gagal' })
  }
  if (!canEnter(result.user)) {
    return json(403, { success: false, error: 'Role Anda tidak diizinkan masuk Portal Karyawan.' })
  }
  return json(200, { success: true, user: result.user }, { 'set-cookie': sessionCookie(result.token) })
}

/* ── Pages ─────────────────────────────────────────────────────────────── */

const PAGE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap');

  :root {
    --bg: #f8f6f3;
    --surface: #ffffff;
    --surface-warm: #faf8f5;
    --ink: #2c2c2c;
    --ink-soft: #5a5a5a;
    --ink-mute: #9a9a9a;
    --line: #e8e4e0;
    --line-strong: #d4d0cc;
    --accent: #4a7c59;
    --accent-deep: #3d6b4c;
    --accent-soft: #e8f0ea;
    --accent-warm: #8b6f47;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
    --shadow-lg: 0 12px 32px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06);
    --radius-sm: 6px;
    --radius: 12px;
    --radius-lg: 20px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    background: var(--bg);
    color: var(--ink);
    font-family: "Inter", system-ui, sans-serif;
    overflow-x: hidden;
  }

  /* ── Left panel: natural scene ──────────────────────────────────── */
  .brand-panel {
    position: relative;
    padding: 56px 48px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: linear-gradient(160deg, #e8f0ea 0%, #d4e4d8 50%, #c8dcc8 100%);
    overflow: hidden;
  }

  .brand-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 80% 60% at 20% 80%, rgba(139,111,71,0.08) 0%, transparent 60%),
      radial-gradient(ellipse 60% 80% at 80% 20%, rgba(74,124,89,0.1) 0%, transparent 60%);
    pointer-events: none;
  }

  .brand-panel::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 120px;
    background: linear-gradient(to top, rgba(74,124,89,0.12), transparent);
    pointer-events: none;
  }

  .brand-top {
    position: relative;
    z-index: 1;
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: rgba(255,255,255,0.7);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.8);
    border-radius: 100px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
    box-shadow: var(--shadow-sm);
  }

  .brand-mark::before {
    content: '';
    width: 8px;
    height: 8px;
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .brand-hero {
    position: relative;
    z-index: 1;
    margin-top: 72px;
  }

  .brand-hero h1 {
    font-family: "Source Serif 4", Georgia, serif;
    font-size: clamp(40px, 4.5vw, 56px);
    font-weight: 600;
    line-height: 1.08;
    letter-spacing: -0.02em;
    color: var(--ink);
  }

  .brand-hero h1 span {
    display: block;
    color: var(--accent);
    font-style: italic;
  }

  .brand-hero p {
    margin-top: 24px;
    font-size: 16px;
    line-height: 1.7;
    color: var(--ink-soft);
    max-width: 420px;
  }

  .brand-stats {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 56px;
  }

  .stat-card {
    padding: 20px;
    background: rgba(255,255,255,0.6);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.7);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    transition: transform 200ms ease, box-shadow 200ms ease;
  }

  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .stat-card .num {
    font-size: 32px;
    font-weight: 700;
    color: var(--ink);
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .stat-card .lbl {
    margin-top: 8px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .brand-bottom {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--ink-mute);
  }

  .brand-bottom .dot {
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
  }

  /* ── Right panel: form ───────────────────────────────────────────── */
  .form-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 56px 48px;
    position: relative;
  }

  .form-panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--line-strong), transparent);
  }

  .form-card {
    width: 100%;
    max-width: 420px;
  }

  .form-header {
    margin-bottom: 40px;
  }

  .form-header .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--accent-soft);
    border-radius: 100px;
    font-size: 12px;
    font-weight: 500;
    color: var(--accent-deep);
  }

  .form-header .eyebrow::before {
    content: '';
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
  }

  .form-header h2 {
    margin-top: 24px;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink);
  }

  .form-header p {
    margin-top: 10px;
    font-size: 15px;
    color: var(--ink-mute);
    line-height: 1.6;
  }

  .field-group {
    margin-bottom: 24px;
  }

  .field-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-soft);
    margin-bottom: 8px;
  }

  .field-group input {
    width: 100%;
    height: 52px;
    padding: 0 18px;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font-size: 16px;
    outline: none;
    transition: border-color 200ms ease, box-shadow 200ms ease;
  }

  .field-group input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-soft);
  }

  .field-group input::placeholder {
    color: var(--ink-mute);
  }

  .form-actions {
    margin-top: 32px;
  }

  .btn-primary {
    width: 100%;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    border: none;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 200ms ease;
    box-shadow: var(--shadow-md);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-deep);
    transform: translateY(-1px);
    box-shadow: var(--shadow-lg);
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(0);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary .arrow {
    transition: transform 200ms ease;
  }

  .btn-primary:hover:not(:disabled) .arrow {
    transform: translateX(4px);
  }

  .form-footer {
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--ink-mute);
  }

  .form-footer .secure {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .form-footer .secure svg {
    width: 14px;
    height: 14px;
    color: var(--accent);
  }

  .err {
    display: none;
    margin-top: 20px;
    padding: 14px 18px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: var(--radius);
    color: #991b1b;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
  }

  .err.visible {
    display: block;
  }

  /* ── Responsive ─────────────────────────────────────────────────── */
  @media (max-width: 900px) {
    body {
      grid-template-columns: 1fr;
    }

    .brand-panel {
      display: none;
    }

    .form-panel {
      padding: 40px 24px;
    }
  }
`

/** Standalone natural sign-in page. */
export function loginPageHtml(): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#f8f6f3" />
<title>Masuk — Portal Karyawan</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet" />
<style>${PAGE_CSS}</style>
</head>
<body>
  <aside class="brand-panel">
    <div class="brand-top">
      <div class="brand-mark">PT Rebinmas Jaya</div>
    </div>
    <div class="brand-hero">
      <h1>Portal<span>Karyawan</span></h1>
      <p>Master Informasi Karyawan Terpusat — HRD PT Rebinmas Jaya. Akses data karyawan, riwayat perubahan, dan informasi sistem HR dalam satu portal terintegrasi.</p>
    </div>
    <div class="brand-stats">
      <div class="stat-card">
        <div class="num">7.6K+</div>
        <div class="lbl">Karyawan</div>
      </div>
      <div class="stat-card">
        <div class="num">16</div>
        <div class="lbl">Divisi</div>
      </div>
      <div class="stat-card">
        <div class="num">24/7</div>
        <div class="lbl">Akses</div>
      </div>
    </div>
    <div class="brand-bottom">
      <span class="dot"></span>
      <span>Sistem Online · RS256 Secured</span>
    </div>
  </aside>

  <main class="form-panel">
    <div class="form-card">
      <div class="form-header">
        <div class="eyebrow">Portal Karyawan</div>
        <h2>Masuk</h2>
        <p>Gunakan akun portal Anda untuk mengakses data karyawan.</p>
      </div>
      <form id="f" autocomplete="on">
        <div class="field-group">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" required autofocus placeholder="Masukkan username" autocomplete="username" />
        </div>
        <div class="field-group">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" required placeholder="Masukkan password" autocomplete="current-password" />
        </div>
        <div class="form-actions">
          <button type="submit" id="btn" class="btn-primary">
            <span>Masuk</span>
            <span class="arrow">→</span>
          </button>
        </div>
        <div class="err" id="err"></div>
      </form>
      <div class="form-footer">
        <span class="secure">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          Koneksi Aman
        </span>
        <span>v1.0.0</span>
      </div>
    </div>
  </main>
<script>
(function () {
  var base = ${JSON.stringify(MODULE_PREFIX)};
  var f = document.getElementById('f'), err = document.getElementById('err'), btn = document.getElementById('btn');
  function fail(msg) { err.textContent = msg; err.classList.add('visible'); btn.disabled = false; }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true; err.classList.remove('visible');
    fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: document.getElementById('username').value.trim(), password: document.getElementById('password').value }),
    }).then(async function (res) {
      var b = {}; try { b = await res.json(); } catch (_) {}
      if (!res.ok || b.success === false) { fail(b.error || ('HTTP ' + res.status)); return; }
      location.href = base + '/';
    }).catch(function () { fail('Tidak dapat menghubungi server.'); });
  });
})();
</script>
</body>
</html>`
}

/** Shown when a VALID but non-allowed session opens the app in a browser. */
export function forbiddenPage(user: Identity, prefix: string): Response {
  const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>403 — Portal Karyawan</title><style>${PAGE_CSS}</style></head>
<body><main class="card">
<h1>Akses Ditolak</h1>
<p class="sub">Portal Karyawan dibatasi untuk role portal terdaftar.<br />
Anda masuk sebagai <strong>${escapeHtml(user.name || user.email)}</strong> (${escapeHtml(user.role || 'tanpa role')}).</p>
<button type="button" onclick="fetch('${prefix}/api/auth/logout',{method:'POST'}).then(function(){location.href='${prefix}/login'})">Keluar</button>
</main></body></html>`
  return new Response(html, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

/** Escape user-controlled strings before embedding into HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
