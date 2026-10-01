/**
 * scripts/ui-probe.mjs — end-to-end UI verification (v2, hang-proof).
 *
 * - Every step logs synchronously to scripts/ui-probe.log (appendFileSync),
 *   so a wedge always shows WHERE it stopped.
 * - External requests (Google Fonts) are aborted — offline-proof networkidle.
 * - No networkidle waits: domcontentloaded + explicit selectors only.
 * - Global 3-minute watchdog.
 *
 * Run: node scripts/ui-probe.mjs
 */
import { createSign, randomBytes } from 'node:crypto'
import { readFileSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(
  resolve('D:/Gawean Rebinmas/Main Dashboard/Module Services/workshop-ims/node_modules/playwright'),
)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = resolve(ROOT, '.agents', 'shots')
const LOG = resolve(ROOT, 'scripts', 'ui-probe.log')
mkdirSync(SHOTS, { recursive: true })
writeFileSync(LOG, `ui-probe start ${new Date().toISOString()}\n`)

function log(msg) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`
  appendFileSync(LOG, line + '\n')
  console.log(line)
}

const BASE = 'http://127.0.0.1:3001/employee-master'
const errors = []

// 3-minute watchdog
const watchdog = setTimeout(() => {
  log('WATCHDOG TIMEOUT — dumping and exiting')
  process.exit(2)
}, 180_000)

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function mintToken() {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(
    JSON.stringify({
      userId: 99,
      name: 'UI Tester',
      email: 'ui.tester@ptrj.local',
      role: 'ADMIN',
      iat: now,
      exp: now + 3600,
      jti: randomBytes(8).toString('hex'),
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  signer.end()
  const sig = signer
    .sign(readFileSync(resolve(ROOT, '../..', 'keys/private.pem')))
    .toString('base64url')
  return `${header}.${payload}.${sig}`
}

async function main() {
  log('minting token')
  const token = mintToken()

  log('launching chromium')
  const browser = await chromium.launch({ headless: true, timeout: 60_000 })
  log('chromium launched')

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([
    { name: 'auth-token', value: token, domain: '127.0.0.1', path: '/', sameSite: 'Lax' },
  ])
  // Offline-proof: abort anything that is not our gateway.
  await ctx.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith('http://127.0.0.1:3001') || url.startsWith('http://localhost:3001')) {
      return route.continue()
    }
    return route.abort()
  })

  const page = await ctx.newPage()
  page.setDefaultTimeout(20_000)
  // External (fonts) requests are deliberately aborted above — a blocked
  // fetch logs a console error that is NOT an app defect. Track and skip.
  const blocked = new Set()
  page.on('requestfailed', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:3001')) blocked.add(r.url())
  })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (text.includes('net::ERR_FAILED') && blocked.size > 0) return // our own font abort
    errors.push(`console: ${text}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  async function shot(name) {
    await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: false })
    log(`  shot: ${name}.png`)
  }

  log('1. goto Ringkasan')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.waitForSelector('.stathero__figure', { timeout: 20_000 })
  await page.waitForFunction(
    () => (document.querySelector('.stathero__figure')?.textContent ?? '0').replace(/[^0-9]/g, '') !== '0',
    { timeout: 15_000 },
  )
  log(`  hero figure: ${(await page.textContent('.stathero__figure'))?.trim()}`)
  await page.waitForSelector('.bar__fill', { timeout: 15_000 })
  await shot('01-ringkasan')

  log('2. goto Data Manual')
  await page.click('a[href="/employee-master/daftar"]')
  await page.waitForSelector('table.data tbody .cell-name', { timeout: 20_000 })
  log(`  rows rendered: ${await page.locator('table.data tbody tr').count()}`)
  await shot('02-daftar')

  log('3. open detail drawer')
  await page.locator('table.data tbody tr').first().click()
  await page.waitForSelector('.drawer', { timeout: 8_000 })
  log(`  drawer: ${(await page.textContent('.drawer h2'))?.trim()}`)
  await shot('03-drawer-detail')

  log('4. edit mode')
  await page.click('button:has-text("Ubah data")')
  await page.waitForSelector('.drawer .fsection', { timeout: 8_000 })
  await shot('04-drawer-edit')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  log('5. goto Data Sistem')
  await page.click('a[href="/employee-master/sistem"]')
  await page.waitForSelector('table.data tbody .cell-name', { timeout: 25_000 })
  log(`  rows rendered: ${await page.locator('table.data tbody tr').count()}`)
  await shot('05-sistem')

  log('6. sistem detail drawer')
  await page.waitForTimeout(600)
  await page.locator('table.data tbody tr').first().click()
  await page.waitForSelector('.drawer', { timeout: 8_000 })
  await shot('06-sistem-detail')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  log('7. goto Riwayat')
  await page.click('a[href="/employee-master/riwayat"]')
  await page.waitForSelector('table.data, .empty', { timeout: 12_000 })
  await shot('07-riwayat')

  log('8. mobile 375px Ringkasan')
  await page.setViewportSize({ width: 375, height: 760 })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.waitForSelector('.stathero__figure', { timeout: 20_000 })
  await shot('08-mobile-ringkasan')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  log(`  horizontal overflow at 375px: ${overflow ? 'YES (FAIL)' : 'no (pass)'}`)

  await browser.close()
  clearTimeout(watchdog)

  if (errors.length) {
    log('PAGE ERRORS:')
    for (const e of [...new Set(errors)].slice(0, 10)) log(`  ! ${e}`)
    process.exitCode = 1
  } else {
    log('no console/page errors — PROBE OK')
  }
}

main().catch((e) => {
  if (errors.length) {
    for (const x of [...new Set(errors)].slice(0, 10)) appendFileSync(LOG, `  ! ${x}\n`)
  }
  log(`UI PROBE FAILED: ${e?.stack ?? e}`)
  process.exit(1) // hard-exit: a failed run must not leak the browser process
})
