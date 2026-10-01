#!/usr/bin/env node
/* =====================================================================
 * scripts/port-healer.cjs — Anti-Zombie Port Healer (Windows-first)
 * -----------------------------------------------------------------------------
 * ATURAN MONOREPO (user mandate 2026-08-28):
 *   "Kalau error port in-use PERSISTEN, hancurkan proses lama NO MATTER WHAT
 *    supaya service baru bisa bind ke port kontraknya."
 *
 * Digunakan dua cara:
 *   1. CLI pre-start  : node scripts/port-healer.cjs <port> [service-name]
 *                       exit 0 = port bebas, exit 1 = masih tertahan.
 *   2. Library import : const { healPort } = require('./scripts/port-healer.cjs')
 *                       (dipakai server_bun.js saat Bun.serve gagal EADDRINUSE)
 *
 * Tingkat eskalasi:
 *   L1 — Bunuh PID pemilik port yang MASIH HIDUP (taskkill /T /F = seisi tree).
 *   L2 — Owner PID di netstat sudah MATI (zombie attribution): socket tertahan
 *        lewat handle yang DIWARISI proses keturunan. L1 tidak bisa — lanjut L3.
 *   L3 — "No matter what": bunuh semua bun.exe/node.exe milik repo ini yang
 *        TIDAK memegang port terlindungi (port kontrak modul lain), lalu
 *        ulangi L1. Nonaktifkan dengan env PORT_HEALER_PASSIVE=1.
 *
 * Yang TIDAK pernah dibunuh:
 *   - proses sendiri (self pid)
 *   - pemegang port terlindungi (port kontrak modul lain + dashboard kecuali
 *     saat yang dibebaskan justru 3001 — gateway memang mengelola siklus
 *     hidup dashboard dan me-respawn-nya sendiri)
 *   - di luar Windows: hanya L1 (process.kill), tanpa L3.
 * ===================================================================== */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const SELF_PID = process.pid;
const IS_WIN = process.platform === 'win32';

/** Port kontrak yang dianggap "milik service lain" — JANGAN dibunuh pemegangnya. */
const DEFAULT_PROTECTED_PORTS = new Set([
    3001, // gateway utama (target port tetap dibebaskan lewat L1 — bukan lewat L3)
    3002, // gateway fallback (PORT=3002)
    3101, // report-center
    3102, // rebinmas-jaya-server (server-monitor)
    3104, // daftar-upah
    5176, 5177, 5178, // absen, monitoring-beras, file-legacy (eksternal)
    8001, // sql-gateway
    8003, // ifess-server
    8010, // workshop-ims
    8011, // rjfm
]);

function log(service, msg) {
    const line = `[port-healer${service ? ':' + service : ''}] ${msg}`;
    if (typeof console !== 'undefined') console.log(line);
}

/** Sync sleep sederhana (healer jalan di awal proses, 800ms busy-wait tak terasa). */
function sleepMs(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* busy */ }
}

/* ── helpers dasar ─────────────────────────────────────────────────────── */

function netstatListeners() {
    // → [{ port, pid }] semua baris LISTENING TCP
    try {
        const out = execSync('netstat -ano -p TCP', {
            encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        });
        const rows = [];
        for (const line of out.split(/\r?\n/)) {
            const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
            if (m) rows.push({ port: Number(m[1]), pid: Number(m[2]) });
        }
        return rows;
    } catch {
        return [];
    }
}

function ownersOf(port, rows) {
    const list = rows || netstatListeners();
    const pids = new Set();
    for (const r of list) if (r.port === port && r.pid) pids.add(r.pid);
    return [...pids];
}

function pidAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (e) { return e && e.code === 'EPERM'; } // EPERM = hidup tapi tanpa izin
}

function killTree(pid) {
    if (!pid || pid === SELF_PID) return false;
    try {
        if (IS_WIN) {
            execSync(`taskkill /PID ${pid} /T /F`, {
                timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
            });
        } else {
            process.kill(pid, 'SIGKILL');
        }
        return true;
    } catch {
        return false;
    }
}

/** Daftar proses {pid, name, cmd} via PowerShell CIM (EncodedCommand = bebas masalah quoting). */
function winProcesses() {
    if (!IS_WIN) return [];
    const script = 'Get-CimInstance Win32_Process | ' +
        'Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 2';
    try {
        const enc = Buffer.from(script, 'utf16le').toString('base64');
        const out = execSync(`powershell -NoProfile -EncodedCommand ${enc}`, {
            encoding: 'utf8', timeout: 45000, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const json = JSON.parse(out);
        return Array.isArray(json) ? json : [json];
    } catch {
        return [];
    }
}

/** Pemegang port terlindungi (set pid) — agar L3 tidak menyentuh service lain. */
function protectedPidSet(protectedPorts) {
    const pids = new Set();
    for (const r of netstatListeners()) {
        if (protectedPorts.has(r.port) && r.pid) pids.add(r.pid);
    }
    return pids;
}

/* ── inti healer ───────────────────────────────────────────────────────── */

/**
 * Bebaskan `port`. Return true bila port bebas (tak ada LISTENING tersisa).
 * Opsi: { service, passive, protectedPorts, log }.
 */
function healPort(port, opts = {}) {
    const service = opts.service || `port-${port}`;
    const say = opts.log || ((m) => log(service, m));
    const passive = opts.passive ||
        process.env.PORT_HEALER_PASSIVE === '1' || process.env.PORT_HEALER_PASSIVE === 'true';

    // Port terlindungi: kontrak modul lain + (dashboard 3100 kecuali target = 3001)
    const protectedPorts = new Set(DEFAULT_PROTECTED_PORTS);
    if (Number(port) !== 3001) protectedPorts.add(3100);
    if (Array.isArray(opts.protectedPorts)) opts.protectedPorts.forEach(p => protectedPorts.add(Number(p)));

    const ROUND_MAX = 3;
    for (let round = 1; round <= ROUND_MAX; round++) {
        const rows = netstatListeners();
        let owners = ownersOf(port, rows).filter(pid => pid !== SELF_PID);
        if (owners.length === 0) {
            if (round > 1) say(`port ${port} bebas (round ${round - 1} cukup).`);
            return true;
        }

        // ── L1: bunuh owner yang hidup ──
        const deadOwners = [];
        for (const pid of owners) {
            if (pidAlive(pid)) {
                say(`L1: port ${port} dipegang PID hidup ${pid} — taskkill /T /F`);
                killTree(pid);
            } else {
                deadOwners.push(pid);
            }
        }

        // beri waktu kernel melepas socket
        sleepMs(800);

        if (ownersOf(port).filter(p => p !== SELF_PID).length === 0) return true;

        // ── L3: zombie / membandel — sapu proses repo tanpa port terlindung ──
        if (passive) {
            say(`PASSIVE: masih tertahan (${deadOwners.length ? 'owner mati: ' + deadOwners.join(', ') : 'owner hidup'}) — tidak melakukan sweep agresif.`);
            continue;
        }
        if (!IS_WIN) continue;

        const protPids = protectedPidSet(protectedPorts);
        // Repo root default = satu level di atas folder script ini (root copy:
        // root monorepo; copy modul: root modul — sesuai kontrak isolasi).
        const repoRoot = String(process.env.PORT_HEALER_REPO_ROOT || path.resolve(__dirname, '..')).toLowerCase();
        const procs = winProcesses();
        let killed = 0;
        for (const p of procs) {
            const pid = Number(p && p.ProcessId);
            if (!pid || pid === SELF_PID || protPids.has(pid)) continue;
            const name = String(p.Name || '').toLowerCase();
            if (!/^bun(\.exe)?$/.test(name) && !/^node(\.exe)?$/.test(name)) continue;
            const cmd = String(p.CommandLine || '').toLowerCase();
            const ours = (repoRoot && cmd.includes(repoRoot)) ||
                cmd.includes('server_bun.js') ||
                cmd.includes('module services');
            if (!ours) continue;
            say(`L3: bunuh proses yatim repo — PID ${pid} (${name}) ${cmd.slice(0, 110)}`);
            killTree(pid);
            killed++;
        }
        if (killed === 0) say(`L3: tidak ada kandidat proses repo yang bisa dibunuh.`);
        sleepMs(800);
    }

    const left = ownersOf(port).filter(p => p !== SELF_PID);
    if (left.length === 0) return true;
    say(`GAGAL: port ${port} masih dipegang PID ${left.join(', ')} setelah ${ROUND_MAX} round.`);
    return false;
}

/* ── CLI ────────────────────────────────────────────────────────────────── */

if (require.main === module) {
    const port = Number(process.argv[2]);
    const service = process.argv[3] || `port-${port}`;
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        console.error('Usage: node scripts/port-healer.cjs <port> [service-name]');
        process.exit(2);
    }
    const owners = ownersOf(port);
    if (owners.length === 0) {
        log(service, `port ${port} sudah bebas — lanjut start.`);
        process.exit(0);
    }
    log(service, `port ${port} tertahan (owner netstat: ${owners.join(', ') || '-'}) — healing...`);
    const ok = healPort(port, { service });
    process.exit(ok ? 0 : 1);
}

module.exports = { healPort, ownersOf, pidAlive, killTree };
