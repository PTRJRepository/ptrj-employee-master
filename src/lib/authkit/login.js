// shared/authkit/login.js — Portal-compatible credential login (optional add-on)
//
// Extends the verify-only kit with LOGIN against the SAME identity store the
// gateway/portal uses: MSSQL extend_db_ptrj.user_ptrj (bcrypt hashes) +
// RS256 signing with the repo keys/private.pem. Tokens issued here are
// byte-compatible with Dashboard_Utama/utils/auth-service.ts — the resulting
// `auth-token` cookie is accepted by the gateway, every module's
// verifyPortalCookie(), and the portal itself.
//
// Copy this file INTO your module alongside index.js (copy-per-module rule).
// Dependencies are LAZY-IMPORTED (mssql, bcryptjs) and resolved up-tree from
// the repo root node_modules, so the kit itself stays dependency-light.
//
// Exports: loginWithCredentials({ email, password, keysDir }) →
//   { ok, status, error?, token?, user? }

export async function loginWithCredentials({ email, password, keysDir } = {}) {
    if (!email || !password) {
        return { ok: false, status: 400, error: 'Email dan password harus diisi' };
    }
    // Lazy imports keep startup fast when login is never used.
    const [{ default: sql }, { default: bcrypt }, { createSign }, { readFileSync }, { resolve }] =
        await Promise.all([
            import('mssql'), import('bcryptjs'),
            import('node:crypto'), import('node:fs'), import('node:path'),
        ]);

    const env = process.env;

    // Dev bypass — same env switches as the portal (Dashboard_Utama auth-service).
    const BYPASS_USER = env.AUTH_BYPASS_USERNAME || 'bypss_ptrj';
    const BYPASS_PASS = env.AUTH_BYPASS_PASSWORD || 'bypass_ptrj123';
    if (env.AUTH_BYPASS_ENABLED !== 'false' && email === BYPASS_USER && password === BYPASS_PASS) {
        return issue(sql, createSign, readFileSync, resolve, keysDir, {
            id: 0, name: 'Bypass PTRJ', email: BYPASS_USER, role: 'ADMIN', divisi: 'ALL',
        });
    }

    try {
        const pool = await new sql.ConnectionPool({
            server: env.MSSQL_HOST || '10.0.0.110',
            port: parseInt(env.MSSQL_PORT || '1433'),
            user: env.MSSQL_USER || 'sa',
            password: env.MSSQL_PASSWORD || 'ptrj@123',
            database: env.MSSQL_DATABASE || 'extend_db_ptrj',
            options: { encrypt: false, trustServerCertificate: true },
            connectionTimeout: parseInt(env.MSSQL_CONNECTION_TIMEOUT_MS || '3000'),
            requestTimeout: parseInt(env.MSSQL_REQUEST_TIMEOUT_MS || '5000'),
            pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
        }).connect();

        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT * FROM user_ptrj WHERE email = @email');
        const row = result.recordset[0];
        if (!row) return { ok: false, status: 401, error: 'Email atau password salah' };

        const valid = await bcrypt.compare(password, row.password);
        if (!valid) return { ok: false, status: 401, error: 'Email atau password salah' };

        return issue(sql, createSign, readFileSync, resolve, keysDir, {
            id: row.id, name: row.name, email: row.email, role: row.role, divisi: row.divisi ?? null,
        });
    } catch (e) {
        console.error('[authkit:login] authentication error:', e.message);
        return { ok: false, status: 500, error: 'Gagal melakukan autentikasi' };
    }
}

function issue(sql, createSign, readFileSync, resolve, keysDir, user) {
    let pem;
    try {
        pem = readFileSync(resolve(keysDir, 'private.pem'), 'utf8');
    } catch {
        return { ok: false, status: 500, error: 'keys/private.pem not found' };
    }
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: 'RS256', typ: 'JWT' });
    // SAME payload shape as Dashboard_Utama/utils/auth-service.ts.
    const body = b64({
        userId: user.id, email: user.email, name: user.name, role: user.role,
        username: user.email,
        divisi: user.divisi || null, division: user.divisi || null,
        divisions: user.divisi ? [user.divisi] : [],
        iat: now, exp: now + 8 * 3600,
    });
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${body}`);
    signer.end();
    const token = `${header}.${body}.${signer.sign(pem, 'base64url')}`;
    return {
        ok: true,
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
}
