/**
 * src/lib/authkit/index.d.ts
 * -----------------------------------------------------------------------------
 * Type declarations for the copied (copy-per-module rule) shared/authkit JS
 * files so `tsc --noEmit` stays strict-clean when importing them from TS.
 */

export interface GatewayIdentity {
    userId: number | string;
    name: string;
    email: string;
    role: string;
    source?: string;
}

export interface ResolveOptions {
    keysDir?: string;
    tokenIsValue?: boolean;
}

/** Read gateway-injected X-User-* headers (null when not reached via gateway). */
export function verifyGatewayIdentity(headers: Record<string, unknown>): GatewayIdentity | null;

/** Case-insensitive role membership check. */
export function hasRole(user: unknown, ...roles: string[]): boolean;

/** RS256-verify a portal JWT with keys/public.pem; cached until exp − 5s. */
export function verifyPortalCookie(token: string | null | undefined, opts?: ResolveOptions): Record<string, unknown> | null;

/** Extract the portal token from a Cookie header string. */
export function extractPortalToken(cookieHeader: string | null | undefined): string | null;

/** Gateway headers first, portal cookie second — one-call identity. */
export function resolveIdentity(args: {
    headers?: Record<string, unknown>;
    cookie?: string;
    opts?: ResolveOptions;
}): GatewayIdentity | null;

/** Express-style middleware (unused under Bun.serve, kept for parity). */
export function requireAuth(options?: { roles?: string[]; keysDir?: string }): unknown;
