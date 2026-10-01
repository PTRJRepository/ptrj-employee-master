/**
 * src/lib/authkit/session.d.ts — types for the copied session.js helper.
 */

export declare const PORTAL_COOKIE: string
export declare const PORTAL_MAX_AGE: number

/** Set-Cookie value for a freshly issued portal token. */
export declare function sessionCookie(token: string): string

/** Set-Cookie value that clears the session. */
export declare function clearSessionCookie(): string

/** Ready-made Response for a loginWithCredentials() result. */
export declare function loginResponse(
  result: { ok: boolean; status?: number; error?: string; token?: string; user?: unknown },
  opts?: { redirectTo?: string },
): Response
