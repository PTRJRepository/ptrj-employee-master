# Module Context — employee-master

You (an agent) are working inside `Module Services/employee-master`, one module
of the Main Dashboard monorepo. Read this before changing anything.
Full platform rulebook: repo root `docs/MONOREPO.md`. Module README:
[`README.md`](README.md).

## What this is

Portal Karyawan Terpusat (HRD) for PT Rebinmas — a manually-maintained employee
master (Excel-seeded, multi-user editable, per-field audit trail) plus a
read-only browser over the production HR tables. One Bun process serves BOTH the
Elysia API and the built Vite SPA:

```
src/index.ts          entry: Bun.serve, loopback peer check, shutdown/pool close
src/server.ts         Elysia app: /api/health + .use(manualRoutes) + .use(sistemRoutes)
src/http/requestHandler.ts   prefix strip → assets → auth gate → /api → SPA index.html
src/http/staticFrontend.ts   serves web/dist
src/lib/auth/{guard,flow}.ts identity + role policy + login/logout/me + gate
src/lib/authkit/*.js         COPY of shared/authkit (never import across modules)
src/lib/db/pool.ts           one mssql pool; assertSelectOnly() fence for db_ptrj
src/lib/employeeSchema.ts    EMPLOYEE_COLUMNS / EMPLOYEE_FIELDS / DIVISIONS / HEADER_MAP
src/routes/manual.ts         CRUD on EMPLOYEE_MASTER + EMPLOYEE_CHANGES audit
src/routes/sistem.ts         read-only HR_* browse (db_ptrj)
src/routes/common.ts         currentUser / intParam / strParam / coerceValue / 401-403
scripts/schema.ts            idempotent DDL (extend_db_ptrj)
scripts/seed.ts              "Agustus 2026.xlsx" → EMPLOYEE_MASTER (16 sheets, 7625 rows)
scripts/port-healer.cjs      kills a stale holder of :8018 before bind
scripts/ui-probe.mjs         Playwright smoke of the SPA (shots in .agents/shots/)
web/                         React 19 + Vite SPA → web/dist (base '/employee-master/')
```

`EMPLOYEE_COLUMNS` is the single source of truth for the manual table: both the
CRUD routes and the Excel seed import it, so validation and seeding cannot drift.

## Dual access — every module has TWO ways to be reached

| Mode | URL | Auth |
|---|---|---|
| **Via gateway proxy** | `http://localhost:3001/employee-master` | Gateway verified the RS256 cookie, strips inbound `X-User-*`, injects verified `X-User-*` |
| **Direct** (standalone) | `http://localhost:8018/employee-master/` | Module verifies the same `auth-token` cookie against repo `keys/public.pem` (copy in `src/lib/authkit/`) |

Rules that follow:
- **Port kontrak: 8018** (`EMP_BASE_PATH` = `/employee-master`). Do not change
  the port or the mount prefix without explicit user approval — both are
  referenced by `routes-config.json` and the portal menu row.
- The gateway route has `rewritePath: false`: the prefix arrives **intact** and
  the module strips it itself (`requestHandler.ts`). So direct port and gateway
  see the same shape — there is NO double-mount problem here (unlike
  `daftar-upah`'s `/backend/upah`).
- `X-User-*` headers are trusted **only from loopback peers** (this service binds
  `0.0.0.0`, so a raw LAN client could try to forge them). Do not relax that.
- The module runs with **zero other processes**; nothing else starts it.

## Run commands

```bash
cd "Module Services/employee-master"
bun install
bun run schema      # DDL: EMPLOYEE_MASTER + EMPLOYEE_CHANGES
bun run seed        # import Excel (--dry-run / --force / --file / --division)
npm start           # prod: port-healer 8018 → bun src/index.ts
npm run dev         # dev: bun --hot
npm run build       # build SPA → web/dist   (npm run dev:web for Vite :5180)
npm run typecheck   # tsc backend + web
```

After changing code: re-run `npm run typecheck`, then `npm run build` if you
touched `web/`. Optional smoke: `node scripts/ui-probe.mjs` — it drives
`http://127.0.0.1:3001/employee-master` (so gateway + this module must BOTH be
up), mints an ADMIN `auth-token` with repo `keys/private.pem`, and reuses
playwright from `Module Services/workshop-ims/node_modules`. Shots land in
`.agents/shots/`, log in `scripts/ui-probe.log` (last run 2026-10-01 stopped at
step 6, sistem drawer `.drawer` selector timeout — probe debt, not a doc fact).

## graphify

`graphify-out/graph.json` **exists** (built 2026-10-01, 320 nodes / 533 edges,
39 files, commit `cc06fc57`) — it was generated during the module's build
session, not by you. Before answering architecture questions, prefer:

1. `graphify query "<question>"` — scoped subgraph.
2. `graphify path "A" "B" --undirected` — **`--undirected` is required**, the
   graph is built undirected; without it you always get "no directed path".
3. `graphify explain "<concept>"`, `graphify-out/GRAPH_REPORT.md` for the map.

After modifying code run `cd "Module Services/employee-master" && graphify update .`
(AST-only, no API cost, run from module root). If `graphify-out/` is ever absent
(fresh clone — it is not committed), plain Read/Grep/Glob is acceptable until it
is rebuilt; say so rather than pretending the graph exists.

## DB policy (STRICT)

| Database | Access | Tables |
|---|---|---|
| `extend_db_ptrj` | read + write | `EMPLOYEE_MASTER`, `EMPLOYEE_CHANGES` (parameterized DML only) |
| `db_ptrj` | **SELECT-only** | `HR_EMPLOYEE`, `HR_EMPLOYMENT`, `HR_DEPTCODE`, `HR_POSITION`, `HR_EMPFAM` |
| `db_ptrj_mill` | never | out of scope |

- `src/lib/db/pool.ts` → `assertSelectOnly()` throws on any non-SELECT statement
  against `db_ptrj`. Keep that fence; do not add a write path to `db_ptrj`
  (repo-wide rule: db_ptrj / db_ptrj_mill are never written, deleted, or altered).
- The only non-SELECT writers are operator-run scripts: `scripts/schema.ts`
  (DDL) and `scripts/seed.ts` (bulk insert). Runtime handlers never write to
  `db_ptrj`, and never `db_ptrj_mill` at all.
- All SQL stays parameterized (no string-concatenated user input into queries).

## Auth & roles (edit points)

`src/lib/auth/guard.ts`: `ALLOWED_ROLES` (enter), `EDIT_DENY_ROLES`
(`visitor`), `DELETE_ROLES` (`admin`, `superadmin`, `hrd`), `PUBLIC_PATHS`
(`/api/health`, `/api/auth/{login,logout,me}`, `/login`).

Menu visibility in the portal is a **separate** mechanism — `service_ptrj`
`employee-master` + `role_service_permission`, not this allowlist. Verified
2026-10-01 against `extend_db_ptrj`:

- menu row: `serviceId=employee-master`, `name='Karyawan (HRD)'`,
  `path='/employee-master'`, `enabled=1`
- 8 granted roles: `ACCOUNTING, ADMIN, ASISTEN, GM_ESTATE, KERANI, MNGR, SUPERADMIN, VISITOR`
- `EMPLOYEE_MASTER` rows: 7625

**Role reconciliation (2026-10-01):** `GM_ESTATE` added to `ALLOWED_ROLES`
in `guard.ts` (was menu-granted but 403 on entry). `HRD`, `PAJAK`, `MANDOR`,
`AKUNTING` remain in `ALLOWED_ROLES` but have no menu grant — run
`scripts/fix-menu-grants.sql` against `extend_db_ptrj` to add them to
`role_service_permission`. `hasRole()` is case-insensitive, so the uppercase DB
values match the lowercase source lists.

## Isolation / git

- No cross-module imports and no `Dashboard_Utama` imports. Shared code = copy
  (`src/lib/authkit/` mirrors `shared/authkit`; refresh by re-copying, not
  importing).
- **This module has no `.git` of its own yet (2026-10-01)** — the parent repo
  gitignores `Module Services/`. Do NOT `git add/commit` it from the repo root,
  and do not assume `git status` here shows anything. When a
  `ptrj-employee-master` repo is created, switch to per-module commits
  (`docs/MONOREPO.md` §0a).

## Where things live (task → file)

| Task | File |
|---|---|
| Employee CRUD, audit trail, dashboard/meta | `src/routes/manual.ts` |
| Production HR browse (Data Sistem) | `src/routes/sistem.ts` |
| Role/identity policy | `src/lib/auth/guard.ts`, `src/lib/auth/flow.ts` |
| Column set / Excel header map / divisions | `src/lib/employeeSchema.ts` |
| DB fence, pool, connection config | `src/lib/db/pool.ts`, `src/config.ts` |
| Prefix routing, asset serving, SPA fallback | `src/http/requestHandler.ts` |
| Seed quirks (merged headers, gender markers, birth-date split) | `scripts/seed.ts` header comment |
| SPA pages (Ringkasan/Daftar/Sistem/Riwayat) | `web/src/pages/`, routes in `web/src/App.tsx` |
| Gateway route | repo root `routes-config.json` (id `employee-master`) |
| Portal menu row | `service_ptrj` / `role_service_permission` in `extend_db_ptrj` |
