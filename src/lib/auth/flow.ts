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
  const email = String(body.email ?? '').trim()
  const password = String(body.password ?? '')
  const result = await loginWithCredentials({ email, password, keysDir: KEYS_DIR })
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
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: oklch(98.5% 0.004 250); color: oklch(34% 0.018 257);
    font-family: "Inter", ui-sans-serif, system-ui, sans-serif; padding: 24px;
  }
  .card {
    width: 380px; max-width: 100%; background: oklch(98.5% 0.004 250);
    border: 1px solid oklch(90.5% 0.006 252);
    border-radius: 10px; padding: 32px 28px;
  }
  h1 { font-family: "Space Grotesk", "Segoe UI", sans-serif; font-size: 20px; font-weight: 600;
       letter-spacing: -0.02em; color: oklch(24% 0.020 258); }
  h1 span { color: oklch(46% 0.17 256); }
  p.sub { margin-top: 6px; font-size: 13px; color: oklch(50% 0.016 256); line-height: 1.5; }
  label { display: block; margin-top: 18px; font-size: 11px; font-weight: 500;
          letter-spacing: 0.06em; text-transform: uppercase;
          font-family: "JetBrains Mono", monospace; color: oklch(50% 0.016 256); }
  input {
    width: 100%; margin-top: 6px; height: 40px; padding: 0 12px; border-radius: 6px;
    border: 1px solid oklch(84% 0.008 252); background: oklch(98.5% 0.004 250);
    color: oklch(24% 0.020 258); outline: 2px solid transparent; outline-offset: 1px;
    font-size: 14px; transition: border-color 120ms ease-out;
  }
  input:focus { outline: 2px solid oklch(58% 0.20 256); border-color: oklch(58% 0.20 256); }
  button {
    width: 100%; margin-top: 22px; height: 40px; border: 0; border-radius: 6px;
    background: oklch(58% 0.20 256); color: oklch(98.5% 0.01 256);
    font-weight: 600; font-size: 14px; cursor: pointer;
    transition: background-color 120ms ease-out;
  }
  button:hover:not(:disabled) { background: oklch(46% 0.17 256); }
  button:disabled { opacity: 0.55; cursor: default; }
  .err {
    display: none; margin-top: 16px; padding: 10px 12px; border-radius: 6px;
    background: oklch(95% 0.03 25); border: 1px solid oklch(54% 0.19 25);
    color: oklch(44% 0.17 25); font-size: 13px; line-height: 1.4;
  }
  footer { margin-top: 22px; font-size: 11px; color: oklch(63% 0.013 255); text-align: center;
           font-family: "JetBrains Mono", monospace; }
`

/** Standalone corporate-flat sign-in page. */
export function loginPageHtml(): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#f5f7fb" />
<title>Masuk — Portal Karyawan</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>${PAGE_CSS}</style>
</head>
<body>
  <main class="card">
    <h1>Portal <span>Karyawan</span></h1>
    <p class="sub">Master Informasi Karyawan Terpusat — HRD PT Rebinmas Jaya.<br />Masuk dengan akun portal Anda.</p>
    <form id="f" autocomplete="on">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required autofocus placeholder="nama@rebinmas" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required placeholder="••••••••" />
      <button type="submit" id="btn">Masuk</button>
      <div class="err" id="err"></div>
    </form>
    <footer>Sesi RS256 setara portal utama · akun portal yang sama</footer>
  </main>
<script>
(function () {
  var base = ${JSON.stringify(MODULE_PREFIX)};
  var f = document.getElementById('f'), err = document.getElementById('err'), btn = document.getElementById('btn');
  function fail(msg) { err.textContent = msg; err.style.display = 'block'; btn.disabled = false; }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true; err.style.display = 'none';
    fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: document.getElementById('email').value.trim(), password: document.getElementById('password').value }),
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
