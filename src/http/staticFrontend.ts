/**
 * src/http/staticFrontend.ts — serves the built Vite SPA (web/dist).
 * Path-traversal safe; index.html is never cached so new builds show up.
 */
import { extname, resolve, sep } from 'node:path'
import { config } from '../config'

type FrontendHandlerOptions = {
  distDir?: string
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function contentType(path: string) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function safeAssetPath(distDir: string, pathname: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const relative = decoded.replace(/^\/+/, '')
  const candidate = resolve(distDir, relative)
  const insideDist = candidate === distDir || candidate.startsWith(`${distDir}${sep}`)
  return insideDist ? candidate : null
}

export function createFrontendHandler(options: FrontendHandlerOptions = {}) {
  const distDir = resolve(options.distDir ?? config.uiDir)
  const indexPath = resolve(distDir, 'index.html')

  return async function serveFrontend(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    const requestedAsset = extname(pathname) !== ''

    if (requestedAsset) {
      const assetPath = safeAssetPath(distDir, pathname)
      if (!assetPath) return new Response('Not found', { status: 404 })

      const asset = Bun.file(assetPath)
      if (await asset.exists()) {
        return new Response(asset, {
          headers: { 'Content-Type': contentType(assetPath) },
        })
      }
      return new Response('Not found', { status: 404 })
    }

    const index = Bun.file(indexPath)
    if (await index.exists()) {
      // index.html is not content-hashed, so browsers must always revalidate
      // it to pick up new asset hashes after a rebuild.
      return new Response(index, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, must-revalidate',
        },
      })
    }

    return new Response(
      'Frontend build not found. Run `bun run build` before `bun start`.',
      { status: 404 },
    )
  }
}

export const serveFrontend = createFrontendHandler()
