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
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');

  :root {
    --bg: #f5f5f0;
    --surface: #ffffff;
    --ink: #1a1a1a;
    --ink-soft: #4a4a4a;
    --ink-mute: #8a8a8a;
    --line: #1a1a1a;
    --accent: #2563eb;
  --accent-deep: #1d4ed8;
    --accent-soft: #dbeafe;
    --ok: #16a34a;
    --ok-soft: #dcfce7;
    --warn: #ca8a04;
    --warn-soft: #fef9c3;
    --radius: 2px;
    --shadow: 4px 4px 0px var(--ink);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1fr 1fr;
    background: var(--bg);
    color: var(--ink);
    font-family: "Inter", system-ui, sans-serif;
    overflow-x: hidden;
  }

  /* ── Left panel: branding + visual elements ─────────────────────── */
  .brand-panel {
    position: relative;
    padding: 48px 40px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: var(--ink);
    color: var(--bg);
    overflow: hidden;
  }

  .brand-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(245,245,240,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(245,245,240,0.03) 1px, transparent 1px);
    background-size: 32px 32px;
    pointer-events: none;
  }

  .brand-panel::after {
    content: '';
    position: absolute;
    bottom: -120px;
    right: -120px;
    width: 320px;
    height: 320px;
    border: 2px solid rgba(245,245,240,0.08);
    border-radius: 50%;
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
    padding: 8px 14px;
    border: 1px solid rgba(245,245,240,0.2);
    border-radius: var(--radius);
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(245,245,240,0.7);
  }

  .brand-mark::before {
    content: '';
    width: 8px;
    height: 8px;
    background: var(--ok);
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .brand-hero {
    position: relative;
    z-index: 1;
    margin-top: 64px;
  }

  .brand-hero h1 {
    font-family: "Space Grotesk", sans-serif;
    font-size: clamp(36px, 4vw, 52px);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.03em;
    color: var(--bg);
  }

  .brand-hero h1 span {
    display: block;
    color: var(--accent);
  }

  .brand-hero p {
    margin-top: 20px;
    font-size: 15px;
    line-height: 1.7;
    color: rgba(245,245,240,0.6);
    max-width: 400px;
  }

  .brand-stats {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 48px;
  }

  .stat-card {
    padding: 16px;
    border: 1px solid rgba(245,245,240,0.12);
    border-radius: var(--radius);
    background: rgba(245,245,240,0.04);
  }

  .stat-card .num {
    font-family: "Space Grotesk", sans-serif;
    font-size: 28px;
    font-weight: 700;
    color: var(--bg);
    line-height: 1;
  }

  .stat-card .lbl {
    margin-top: 6px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(245,245,240,0.5);
  }

  .brand-bottom {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: rgba(245,245,240,0.4);
  }

  .brand-bottom .dot {
    width: 6px;
    height: 6px;
    background: var(--ok);
    border-radius: 50%;
  }

  /* ── Right panel: login form ────────────────────────────────────── */
  .form-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 40px;
    position: relative;
  }

  .form-panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--accent), var(--accent-deep), var(--accent));
  }

  .form-card {
    width: 100%;
    max-width: 400px;
  }

  .form-header {
    margin-bottom: 36px;
  }

  .form-header .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--accent-soft);
    border-radius: var(--radius);
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
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
    margin-top: 20px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink);
  }

  .form-header p {
    margin-top: 8px;
    font-size: 14px;
    color: var(--ink-mute);
    line-height: 1.6;
  }

  .field-group {
    margin-bottom: 20px;
  }

  .field-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-bottom: 8px;
  }

  .field-group label .req {
    color: var(--accent);
  }

  .field-group input {
    width: 100%;
    height: 48px;
    padding: 0 16px;
    border: 2px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font-family: "Inter", sans-serif;
    font-size: 15px;
    outline: none;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }

  .field-group input:focus {
    border-color: var(--accent);
    box-shadow: var(--shadow);
  }

  .field-group input::placeholder {
    color: var(--ink-mute);
  }

  .field-hint {
    margin-top: 6px;
    font-size: 12px;
    color: var(--ink-mute);
  }

  .form-actions {
    margin-top: 28px;
  }

  .btn-primary {
    width: 100%;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 2px solid var(--ink);
    border-radius: var(--radius);
    background: var(--ink);
    color: var(--bg);
    font-family: "Space Grotesk", sans-serif;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: all 150ms ease;
    box-shadow: var(--shadow);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0px var(--ink);
  }

  .btn-primary:active:not(:disabled) {
    transform: translate(0, 0);
    box-shadow: 2px 2px 0px var(--ink);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary .arrow {
    transition: transform 150ms ease;
  }

  .btn-primary:hover:not(:disabled) .arrow {
    transform: translateX(4px);
  }

  .form-footer {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid #e5e5e0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: var(--ink-mute);
  }

  .form-footer .secure {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .form-footer .secure::before {
    content: '🔒';
    font-size: 12px;
  }

  .err {
    display: none;
    margin-top: 16px;
    padding: 12px 16px;
    border: 2px solid #dc2626;
    border-radius: var(--radius);
    background: #fef2f2;
    color: #991b1b;
    font-size: 13px;
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
      padding: 32px 24px;
    }
  }
`

/** Standalone brutalist sign-in page. */
export function loginPageHtml(): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#1a1a1a" />
<title>Masuk — Portal Karyawan</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
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
          <label for="username">Username <span class="req">*</span></label>
          <input id="username" name="username" type="text" required autofocus placeholder="Masukkan username" autocomplete="username" />
        </div>
        <div class="field-group">
          <label for="password">Password <span class="req">*</span></label>
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
        <span class="secure">Koneksi Aman</span>
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
