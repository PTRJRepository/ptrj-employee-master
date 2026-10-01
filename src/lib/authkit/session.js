// shared/authkit/session.js — Cookie session helpers (optional add-on)
//
// Set/clear the portal `auth-token` cookie from any Bun/Node HTTP response,
// matching the cookie semantics Dashboard_Utama/app/api/auth/login uses
// (httpOnly=false, sameSite=lax, 8h, path=/). Copy into your module
// alongside index.js.

export const PORTAL_COOKIE = 'auth-token';
export const PORTAL_MAX_AGE = 60 * 60 * 8; // 8h, same as the portal login

/** Build a Set-Cookie header value for a freshly issued token. */
export function sessionCookie(token) {
    return `${PORTAL_COOKIE}=${token}; Path=/; Max-Age=${PORTAL_MAX_AGE}; SameSite=Lax`;
}

/** Build a Set-Cookie header value that clears the session. */
export function clearSessionCookie() {
    return `${PORTAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * One-shot helper: given a loginWithCredentials() result, produce a JSON
 * Response with the session cookie set. Zero framework dependency.
 *
 *   const res = loginResponse(await loginWithCredentials({...}), { redirectTo: '/' });
 */
export function loginResponse(result, { redirectTo } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (!result.ok) {
        return new Response(JSON.stringify({ error: result.error }), {
            status: result.status || 401, headers,
        });
    }
    if (redirectTo) headers.Location = redirectTo;
    headers['Set-Cookie'] = sessionCookie(result.token);
    const body = JSON.stringify({
        success: true,
        user: result.user,
        ...(redirectTo ? {} : { token: result.token }),
    });
    return new Response(body, { status: redirectTo ? 302 : 200, headers });
}
