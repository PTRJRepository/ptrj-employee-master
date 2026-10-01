// shared/authkit/index.js — Module Authentication Kit (zero dependencies)
// Copy this file into a module that needs auth; do NOT import across modules.
// See README.md in this folder for the contract and trust rules.

import { createVerify } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Gateway identity headers ────────────────────────────────────────────────
const USER_HEADERS = ['x-user-id', 'x-user-name', 'x-user-email', 'x-user-role'];

/**
 * Identity injected by the gateway AFTER it verified the portal cookie.
 * Returns null when not reached via the gateway (no x-user-id present).
 */
export function verifyGatewayIdentity(headers) {
    const get = (name) => {
        for (const [k, v] of Object.entries(headers || {})) {
            if (k.toLowerCase() === name) return v;
        }
        return undefined;
    };
    const id = get('x-user-id');
    if (id === undefined || id === null || id === '') return null;
    return {
        userId: Number(id) || id,
        name: String(get('x-user-name') ?? ''),
        email: String(get('x-user-email') ?? ''),
        role: String(get('x-user-role') ?? ''),
    };
}

/** Case-insensitive role membership. */
export function hasRole(user, ...roles) {
    if (!user?.role) return false;
    const r = user.role.toUpperCase();
    return roles.some(x => x.toUpperCase() === r);
}

// ─── Portal RS256 cookie verification (direct-port mode) ─────────────────────
let _publicKey = null;
let _publicKeyFile = null;

function findKeysDir(startDir) {
    let dir = resolve(startDir || process.cwd());
    for (let i = 0; i < 6; i++) {
        if (existsSync(resolve(dir, 'keys', 'public.pem'))) return resolve(dir, 'keys');
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function loadPublicKey(opts) {
    const keysDir = opts?.keysDir || findKeysDir();
    if (!keysDir) throw new Error('[authkit] keys/public.pem not found — pass opts.keysDir');
    if (_publicKey && _publicKeyFile === keysDir) return _publicKey;
    _publicKey = readFileSync(resolve(keysDir, 'public.pem'), 'utf-8').trim();
    _publicKeyFile = keysDir;
    return _publicKey;
}

function b64urlToBuffer(value) {
    const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Verified-payload cache: browsers resend the same token every request.
const _verified = new Map();
const VERIFIED_CACHE_MAX = 1000;

/**
 * Verify a portal JWT (RS256). Returns payload on success, null otherwise.
 * Same contract as shared/auth/jwt.js in the gateway — identical key file.
 */
export function verifyPortalCookie(token, opts) {
    if (!token) return null;
    try {
        const cached = _verified.get(token);
        if (cached) {
            if (cached.exp * 1000 > Date.now() - 5000) return cached;
            _verified.delete(token);
        }
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [h, p, s] = parts;
        const header = JSON.parse(b64urlToBuffer(h).toString('utf8'));
        if (header.alg !== 'RS256') return null;
        const verifier = createVerify('RSA-SHA256');
        verifier.update(`${h}.${p}`);
        verifier.end();
        if (!verifier.verify(loadPublicKey(opts), b64urlToBuffer(s))) return null;
        const payload = JSON.parse(b64urlToBuffer(p).toString('utf8'));
        if (payload.exp && payload.exp * 1000 < Date.now()) return null;
        if (_verified.size >= VERIFIED_CACHE_MAX) {
            _verified.delete(_verified.keys().next().value); // evict oldest
        }
        _verified.set(token, payload);
        return payload;
    } catch {
        return null;
    }
}

const PORTAL_COOKIE_RE = /(?:^|;\s*)(?:auth-token|payroll_auth_token)=([^;]+)/;

/** Extract the portal token from a Cookie header string. */
export function extractPortalToken(cookieHeader) {
    if (!cookieHeader) return null;
    const m = cookieHeader.match(PORTAL_COOKIE_RE);
    return m ? m[1] : null;
}

/**
 * Both modes in one call. headers = request headers object (or Headers via
 * headersToObject), cookie = raw Cookie header string OR the token itself
 * when opts.tokenIsValue is true.
 */
export function resolveIdentity({ headers, cookie, opts } = {}) {
    const viaGateway = verifyGatewayIdentity(headers);
    if (viaGateway) return { ...viaGateway, source: 'gateway' };
    const token = opts?.tokenIsValue ? cookie : extractPortalToken(cookie);
    const payload = verifyPortalCookie(token, opts);
    if (!payload) return null;
    return {
        userId: payload.userId ?? payload.sub,
        name: payload.name ?? payload.username ?? '',
        email: payload.email ?? '',
        role: payload.role ?? '',
        source: 'cookie',
    };
}

// ─── Express middleware ──────────────────────────────────────────────────────
/**
 * requireAuth({ roles: ['ADMIN'] }) → 401 without identity, 403 on role miss.
 * On success sets req.user and next().
 */
export function requireAuth(options = {}) {
    return (req, res, next) => {
        // 1) gateway-injected identity (proxy mode)
        let user = verifyGatewayIdentity(req.headers);
        // 2) direct-port fallback: verify portal cookie ourselves
        if (!user) {
            const payload = verifyPortalCookie(
                req.cookies?.['auth-token'] || req.cookies?.['payroll_auth_token']
                    || extractPortalToken(req.headers.cookie),
                options,
            );
            if (payload) {
                user = {
                    userId: payload.userId ?? payload.sub,
                    name: payload.name ?? '',
                    email: payload.email ?? '',
                    role: payload.role ?? '',
                };
            }
        }
        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }
        if (options.roles?.length && !hasRole(user, ...options.roles)) {
            return res.status(403).json({ status: 'error', message: 'Forbidden: role not allowed' });
        }
        req.user = user;
        next();
    };
}

export default {
    verifyGatewayIdentity,
    verifyPortalCookie,
    extractPortalToken,
    resolveIdentity,
    hasRole,
    requireAuth,
};
