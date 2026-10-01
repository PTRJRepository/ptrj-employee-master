/**
 * src/lib/http/json.ts — uniform JSON response helpers.
 */
export function jsonOk(body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(headers ?? {}) },
  })
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: false, error, ...(extra ?? {}) }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
