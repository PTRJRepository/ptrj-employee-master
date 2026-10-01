/**
 * src/http/requestHandler.ts — per-request pipeline.
 *
 * 1. `/` → redirect to the canonical MODULE_PREFIX mount.
 * 2. Prefix-strip so everything downstream sees clean internal paths.
 * 3. Assets (hashed JS/CSS/images) serve directly — never gated (no cookie
 *    semantics needed, gating them would break first paint).
 * 4. Auth traffic layer (login/logout/me + session gate) runs before routing.
 * 5. /api/* → Elysia app; everything else → SPA index.html.
 *
 * `isLoopback` is injected lazily by src/index.ts (it owns the Bun.Server
 * handle used for peer-address checks) so X-User-* header trust can be
 * computed per request against the real TCP peer.
 */
import { extname } from 'node:path'
import { serveFrontend } from './staticFrontend'
import { MODULE_PREFIX, getIdentity } from '../lib/auth/guard'
import { handleAuthTraffic } from '../lib/auth/flow'

type ApiApp = {
  handle(request: Request): Response | Promise<Response>
}

export type LoopbackCheck = (request: Request) => boolean

/**
 * Identity header injected AFTER the auth gate. The gate verifies the
 * session (RS256 cookie, or gateway X-User-* from loopback only); this
 * transport lets route handlers see WHO without re-doing peer checks.
 * Any inbound copy is stripped first — a raw LAN client can forge the
 * header, but it never survives the gate unauthenticated.
 */
export const IDENTITY_HEADER = 'x-emp-identity'

export function createRequestHandler(
  app: ApiApp,
  frontendHandler: (request: Request) => Response | Promise<Response> = serveFrontend,
  isLoopback?: LoopbackCheck,
) {
  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    if (pathname === '/') {
      return Response.redirect(new URL(`${MODULE_PREFIX}/`, url).toString(), 302)
    }
    const behindPrefix = pathname === MODULE_PREFIX || pathname.startsWith(`${MODULE_PREFIX}/`)
    const strippedPath = behindPrefix ? pathname.slice(MODULE_PREFIX.length) || '/' : pathname
    const effective = behindPrefix
      ? new Request(new URL(strippedPath + url.search, url).toString(), request)
      : request
    const isApi = strippedPath === '/api' || strippedPath.startsWith('/api/')
    // Hashed build assets must NEVER be gated: they carry no session and the
    // browser requests them without cookie context the gate could use.
    if (!isApi && extname(strippedPath) !== '') return frontendHandler(effective)
    const accept = request.headers.get('accept') ?? ''
    const wantsHtml =
      !isApi && (accept.includes('text/html') || accept.includes('*/*') || accept === '')
    const loopback = isLoopback ? isLoopback(request) : false
    const gate = await handleAuthTraffic(effective, strippedPath, behindPrefix, wantsHtml, loopback)
    if (gate) return gate
    if (isApi) {
      // Strip any client-supplied identity header, then inject the one the
      // gate just verified (cookie or loopback gateway headers).
      const headers = new Headers(effective.headers)
      headers.delete(IDENTITY_HEADER)
      const identity = getIdentity(effective, loopback)
      if (identity) {
        headers.set(IDENTITY_HEADER, Buffer.from(JSON.stringify(identity)).toString('base64url'))
      }
      return app.handle(new Request(effective, { headers }))
    }
    return frontendHandler(effective)
  }
}
