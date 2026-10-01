/**
 * scripts/debug-sistem.mjs — focused debug: why doesn't the Data Sistem
 * detail drawer open? Logs all console/page errors + network failures.
 */
import { createSign, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(
  resolve('D:/Gawean Rebinmas/Main Dashboard/Module Services/workshop-ims/node_modules/playwright'),
)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'http://127.0.0.1:3001/employee-master'

function b64url(s) { return Buffer.from(s).toString('base64url') }
function mintToken() {
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const p = b64url(JSON.stringify({ userId: 99, name: 'UI Tester', email: 'u@t.local', role: 'ADMIN', iat: now, exp: now + 3600, jti: randomBytes(8).toString('hex') }))
  const s = createSign('RSA-SHA256'); s.update(`${h}.${p}`); s.end()
  return `${h}.${p}.${s.sign(readFileSync(resolve(ROOT, '../..', 'keys/private.pem'))).toString('base64url')}`
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addCookies([{ name: 'auth-token', value: mintToken(), domain: '127.0.0.1', path: '/', sameSite: 'Lax' }])
    await ctx.route('**/*', (r) =>
      r.request().url().startsWith('http://127.0.0.1:3001') ? r.continue() : r.abort(),
    )
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)
    page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text()))
    page.on('pageerror', (e) => console.log('[pageerror]', e.message))
    page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText))
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) console.log('[http]', r.status(), r.url())
    })

    await page.goto(`${BASE}/sistem`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('table.data tbody .cell-name')
    console.log('rows:', await page.locator('table.data tbody tr').count())

    const firstRow = page.locator('table.data tbody tr').first()
    console.log('row text:', (await firstRow.textContent())?.slice(0, 80))
    await firstRow.click()
    await page.waitForTimeout(2500)
    console.log('drawer present:', await page.locator('.drawer').count())
    console.log('scrim present:', await page.locator('.scrim').count())
    // any selected-state leftovers?
    const bodySnippet = await page.evaluate(() => document.body.innerHTML.length)
    console.log('body html len:', bodySnippet)
    await page.screenshot({ path: resolve(ROOT, '.agents', 'shots', 'debug-sistem.png') })
    console.log('shot saved')
  } finally {
    await browser.close()
  }
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
