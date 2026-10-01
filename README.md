# employee-master — Portal Karyawan Terpusat (HRD)

Master data karyawan PT Rebinmas: daftar manual yang bisa diedit (di-seed dari
Excel) plus browser read-only untuk data sistem HR produksi. Satu proses Bun
menyajikan API Elysia + SPA Vite yang sudah di-build.

- Port kontrak: **8018** (`EMP_BASE_PATH` default `/employee-master`)
- Gateway route: `employee-master` di `routes-config.json` → `http://127.0.0.1:8018`
- Menu portal: `service_ptrj` `employee-master` ("Karyawan (HRD)"), group `lainnya`
- Repo git sendiri sudah dibuat (2026-10-01): `ptrj-employee-master` (private, branch `main`, remote `git@github.com:PTRJRepository/ptrj-employee-master.git`)
- Akses LAN: `http://<ip-mesin>:8018/employee-master/` (firewall rule sudah dibuat untuk port 8018)

## Run

```bash
cd "Module Services/employee-master"

bun install        # dependensi module (elysia, mssql, xlsx)
bun run schema     # DDL idempoten: EMPLOYEE_MASTER + EMPLOYEE_CHANGES di extend_db_ptrj
bun run seed       # import "Agustus 2026.xlsx" (16 sheet divisi, 7625 baris)
                   #   opsi: --force (truncate+ulang), --dry-run, --file <path>, --division <nama>

npm start          # produksi: port-healer 8018 → bun src/index.ts
npm run dev        # dev: sama, dengan bun --hot
npm run build      # build SPA → web/dist
npm run dev:web    # Vite dev server :5180 (proxy /employee-master/api → :8018)
npm run typecheck  # tsc backend + web
```

- Direct: `http://localhost:8018/employee-master/` ( `/` redirect ke sana )
- Via gateway: `http://localhost:3001/employee-master`
- Health: `GET /employee-master/api/health` (publik, tanpa sesi)

`npm start` = `node scripts/port-healer.cjs 8018 employee-master && bun src/index.ts`
— port-healer mematikan penduduk lama port 8018 sebelum bind. Jangan jalankan
`bun src/index.ts` langsung kalau port bisa saja tertahan.

## Data sources (kebijakan DB — hard rule)

| Sumber | Database | Akses | Dipakai untuk |
|---|---|---|---|
| `EMPLOYEE_MASTER`, `EMPLOYEE_CHANGES` | `extend_db_ptrj` | **baca + tulis** (parameterized DML, audited) | Tab Data Manual: CRUD + riwayat perubahan |
| `HR_*` (`HR_EMPLOYEE`, `HR_EMPLOYMENT`, `HR_DEPTCODE`, `HR_POSITION`, `HR_EMPFAM`) | `db_ptrj` | **SELECT-only** — `assertSelectOnly` di `src/lib/db/pool.ts` melempar error kalau statement bukan SELECT | Tab Data Sistem: browser read-only |
| `db_ptrj_mill` | — | **tidak pernah** | di luar scope |

Satu-satunya penulis non-SELECT di module ini adalah DDL `scripts/schema.ts`
(dijalankan operator) dan bulk insert `scripts/seed.ts`. Runtime tidak pernah
menulis ke `db_ptrj`.

Seed source: `Agustus 2026.xlsx` (default
`C:/Users/nbgmf/OneDrive/Documents/Agustus 2026.xlsx`), 16 sheet divisi
(`DIVISIONS` di `src/lib/employeeSchema.ts`), 7625 baris. Mapping header Excel →
kolom tabel di `HEADER_MAP` (file yang sama) — dipakai oleh seed dan CRUD
sehingga keduanya tidak bisa drift.

## API

Semua path di bawah prefix mount `/employee-master` (direct port maupun
gateway). Read endpoints mengembalikan objek datanya langsung (mis.
`{ items, total, page, … }`); mutations mengembalikan `{ success: true, … }`;
error `{ success: false, error }` dengan status 400/401/403/500 (`jsonError`).
Frontend membaca `body.error` saat `!res.ok` dan me-redirect ke `/login` pada 401.

| Method | Path | Sumber | Keterangan |
|---|---|---|---|
| GET | `/api/health` | — | publik |
| POST | `/api/auth/login` | `extend_db_ptrj.user_ptrj` | body `{ username, password }` → set cookie `auth-token` (RS256); role di luar allowlist → 403. Username cocokkan terhadap kolom `name` ATAU `email` |
| POST | `/api/auth/logout` | — | publik |
| GET | `/api/auth/me` | — | sesi aktif / 401 JSON |
| GET | `/api/employees` | EMPLOYEE_MASTER | `q`, `division`, `status`, `gender`, `page`, `limit`, `sort`, `dir` |
| GET | `/api/employees/watermark` | EMPLOYEE_MASTER | `COUNT` + `MAX(updated_at)` untuk live polling |
| GET | `/api/employees/:id` | EMPLOYEE_MASTER | detail 1 baris |
| POST | `/api/employees` | EMPLOYEE_MASTER | create (butuh `canEdit`) |
| PATCH | `/api/employees/:id` | EMPLOYEE_MASTER | update + diff per-field ke `EMPLOYEE_CHANGES` (butuh `canEdit`) |
| DELETE | `/api/employees/:id` | EMPLOYEE_MASTER | hard `DELETE` + audit row (butuh `canDelete`) |
| GET | `/api/changes` | EMPLOYEE_CHANGES | `limit`, `since`, `employee_id` — riwayat perubahan |
| GET | `/api/meta` | EMPLOYEE_MASTER | divisions + counts + watermark (bootstrap SPA) |
| GET | `/api/dashboard` | EMPLOYEE_MASTER + CHANGES | headline stats + 10 perubahan terakhir |
| GET | `/api/sistem/employees` | `db_ptrj` HR_* | `q`, `dept`, `active` (Y/N), `page`, `limit` |
| GET | `/api/sistem/employees/:code` | `db_ptrj` HR_* | detail + keluarga (`HR_EMPFAM`) |
| GET | `/api/sistem/depts` | `db_ptrj` HR_* | departemen + headcount aktif |
| GET | `/api/sistem/stats` | `db_ptrj` HR_* | total/aktif/berhenti, top-10 dept, gender |

SPA routes (`web/src/App.tsx`): `/` Ringkasan · `/daftar` Daftar · `/sistem`
Data Sistem · `/bhl` Monitor BHL · `/riwayat` Riwayat. Frontend memanggil
`${'/employee-master/api'}${path}` (`web/src/api.ts`), jadi base path ikut
mount prefix.

### Monitor BHL

Halaman `/bhl` menampilkan karyawan yang perlu dievaluasi BHL (70 hari sejak
tanggal masuk kerja):

| Status | Arti |
|---|---|
| **Terlambat** | Lewat 70 hari (maksimal 30 hari, lebih dari itu tidak ditampilkan) |
| **Segera** | ≤14 hari lagi menuju 70 hari |
| **Akan Datang** | Masih lebih dari 14 hari menuju 70 hari |

Filter dropdown dengan hitungan per status. Sumber data: `EMPLOYEE_MASTER`
(sama dengan Data Manual).

## Auth & roles

Guard ada di `src/lib/auth/guard.ts` + traffic layer `src/lib/auth/flow.ts`,
dijalankan **sebelum** routing Elysia (`src/http/requestHandler.ts`).

Urutan resolusi identitas:

1. Cookie portal RS256 `auth-token` — diverifikasi ke `keys/public.pem` repo
   (copy `src/lib/authkit/`). Tidak bisa dipalsukan.
2. Header gateway `X-User-*` — **hanya dari peer loopback** (127.0.0.1/::1).
   Module bind `0.0.0.0` (LAN), jadi header mentah dari klien LAN ditolak.

Kebijakan akses (lihat `ALLOWED_ROLES` / `EDIT_DENY_ROLES` / `DELETE_ROLES`):

| Aksi | Role |
|---|---|
| Masuk + lihat (view, live polling) | Guard module: `ALLOWED_ROLES` (admin, superadmin, hrd, kerani, akunting, accounting, pajak, mngr, asisten, mandor, visitor — case-insensitive) |
| Create / update | semua role kecuali `visitor` |
| Delete | `admin`, `superadmin`, `hrd` saja |

Menu portal (row `service_ptrj` `employee-master`, label "Karyawan (HRD)",
groupKey `lainnya`) di-grant ke 8 role via `role_service_permission` — verifikasi
langsung ke `extend_db_ptrj` 2026-10-01: `ACCOUNTING, ADMIN, ASISTEN, GM_ESTATE,
KERANI, MNGR, SUPERADMIN, VISITOR`.

> **Gap yang belum diselesaikan (2026-10-01):** dua daftar role ini belum
> sinkron. `GM_ESTATE` punya tile menu tapi **tidak** ada di `ALLOWED_ROLES` →
> klik dari portal kena 403. Sebaliknya `HRD`, `PAJAK`, `MANDOR`, `AKUNTING`
> ada di `ALLOWED_ROLES` tapi tidak punya grant menu → tidak terlihat di portal
> (hanya bisa lewat URL langsung). Sinkronkan `ALLOWED_ROLES` di
> `src/lib/auth/guard.ts` dengan `role_service_permission` (atau sebaliknya)
> sebelum menyebut ini selesai.

Publik tanpa sesi: `/api/health`, `/api/auth/login`, `/api/auth/logout`,
`/api/auth/me`, halaman `/login`. Aset ber-hash tidak digate (butuh first paint).

## Gateway wiring

Route `employee-master` di `routes-config.json` (hot-reload, tanpa restart):

```json
{ "id": "employee-master", "path": "/employee-master", "target": "http://127.0.0.1:8018",
  "rewritePath": false, "healthPath": "/api/health", "timeoutMs": 30000 }
```

`rewritePath: false` — module sendiri yang menerima prefix `/employee-master`
(`EMP_BASE_PATH`), sama bentuknya di direct port dan lewat gateway. Module tidak
perlu dobel-mount route.

## Isolasi

Tidak ada impor lintas module / `Dashboard_Utama`. Shared code = copy
(`src/lib/authkit/` adalah salinan `shared/authkit`). Module berjalan sendiri
tanpa gateway atau portal yang hidup.

Dokumentasi platform: repo root `docs/MONOREPO.md`.
