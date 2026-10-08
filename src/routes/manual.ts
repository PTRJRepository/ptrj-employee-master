/**
 * src/routes/manual.ts — Data Manual (source 1): the Excel-seeded employee
 * master stored in extend_db_ptrj.dbo.EMPLOYEE_MASTER. Fully editable by
 * allowed portal roles (visitor read-only, delete admin/superadmin/hrd).
 *
 * Every mutation writes EMPLOYEE_CHANGES audit rows (per-field diff) so the
 * portal can show "who changed what, when".
 */
import sql from 'mssql'
import { Elysia } from 'elysia'
import { getPool } from '../lib/db/pool'
import { COLUMN_SCHEMA, EMPLOYEE_COLUMNS, EMPLOYEE_FIELDS, SCHEMA_GROUPS } from '../lib/employeeSchema'
import { currentUser, intParam, strParam, coerceValue, sqlTypeFor, unauthorized, forbidden } from './common'
import { canDelete, canEdit } from '../lib/auth/guard'
import { jsonError, jsonOk } from '../lib/http/json'
import type { ColumnKind } from '../lib/employeeSchema'

const TABLE = 'EMPLOYEE_MASTER'
const CHANGES = 'EMPLOYEE_CHANGES'

/** SELECT list for API responses (audit columns too). */
const SELECT_COLS = [
  ...EMPLOYEE_FIELDS,
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
].join(', ')

/** Audit-log writer. Called inside the same transaction as the mutation. */
async function writeAudit(
  tx: sql.Transaction,
  entry: {
    employeeId: number
    employeeName: string
    action: string
    field?: string
    oldValue?: unknown
    newValue?: unknown
    changedBy: string
  },
): Promise<void> {
  await tx
    .request()
    .input('employee_id', sql.Int, entry.employeeId)
    .input('employee_name', sql.NVarChar(200), entry.employeeName)
    .input('action', sql.NVarChar(20), entry.action)
    .input('field', sql.NVarChar(50), entry.field ?? null)
    .input('old_value', sql.NVarChar(1000), entry.oldValue == null ? null : String(entry.oldValue).slice(0, 1000))
    .input('new_value', sql.NVarChar(1000), entry.newValue == null ? null : String(entry.newValue).slice(0, 1000))
    .input('changed_by', sql.NVarChar(100), entry.changedBy)
    .query(
      `INSERT INTO ${CHANGES} (employee_id, employee_name, action, field, old_value, new_value, changed_by)
       VALUES (@employee_id, @employee_name, @action, @field, @old_value, @new_value, @changed_by)`,
    )
}

/** Display helper for audit values (dates → ISO date, null → NULL). */
function display(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

export function manualRoutes(): Elysia {
  const app = new Elysia()
  // ── List (search / filter / sort / paginate) ────────────────────────────
  app.get('/api/employees', async ({ query }) => {
    const q = strParam(query.q)
    const division = strParam(query.division)
    const status = strParam(query.status)
    const gender = strParam(query.gender)
    const page = intParam(query.page, 1, 1_000_000)
    const limit = intParam(query.limit, 50, 500)
    const sortRaw = strParam(query.sort)
    const dir = strParam(query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    const sort = EMPLOYEE_FIELDS.includes(sortRaw) ? sortRaw : 'division'

    const where: string[] = []
    const pool = await getPool()
    const req = pool.request()
    if (q) {
      where.push(`(nama LIKE @q OR no_ktp LIKE @q OR jabatan LIKE @q OR alamat LIKE @q)`)
      req.input('q', sql.NVarChar, `%${q}%`)
    }
    if (division) {
      where.push('division = @division')
      req.input('division', sql.NVarChar, division)
    }
    if (status) {
      where.push('status = @status')
      req.input('status', sql.NVarChar, status)
    }
    if (gender) {
      where.push('gender = @gender')
      req.input('gender', sql.NVarChar, gender)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const countResult = await req
      .input('offset', sql.Int, (page - 1) * limit)
      .input('fetch', sql.Int, limit)
      .query(
        `SELECT COUNT(*) AS total FROM ${TABLE} ${whereSql};
         SELECT ${SELECT_COLS} FROM ${TABLE} ${whereSql}
         ORDER BY ${sort} ${dir}, id ASC
         OFFSET @offset ROWS FETCH NEXT @fetch ROWS ONLY;`,
      )
    const total = Number(countResult.recordset[0]?.total ?? 0)
    const items = (countResult.recordsets as sql.IRecordSet<any>[])[1] ?? []

    return jsonOk({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  })

  // ── Grid schema (column model + grouping tabs) ──────────────────────────
  // Static: built from the in-process registry, so no DB round-trip. Must be
  // registered BEFORE '/api/employees/:id' or the :id route captures it.
  app.get('/api/schema', async () =>
    jsonOk({
      columns: COLUMN_SCHEMA,
      groups: SCHEMA_GROUPS,
      total: COLUMN_SCHEMA.length,
    }),
  )

  // ── Watermark for live polling (cheap COUNT + MAX) ──────────────────────
  app.get('/api/employees/watermark', async () => {
    const pool = await getPool()
    const r = await pool
      .request()
      .query(`SELECT COUNT(*) AS total, MAX(updated_at) AS watermark FROM ${TABLE}`)
    const row = r.recordset[0] ?? {}
    return jsonOk({
      total: Number(row.total ?? 0),
      watermark: row.watermark ? new Date(row.watermark).getTime() : 0,
    })
  })

  // ── One record ──────────────────────────────────────────────────────────
  app.get('/api/employees/:id', async ({ params }) => {
    const id = Number(params.id)
    if (!Number.isInteger(id)) return jsonError(400, 'id tidak valid')
    const pool = await getPool()
    const r = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`SELECT ${SELECT_COLS} FROM ${TABLE} WHERE id = @id`)
    const item = r.recordset[0]
    if (!item) return jsonError(404, 'Karyawan tidak ditemukan')
    return jsonOk({ item })
  })

  // ── Create ──────────────────────────────────────────────────────────────
  app.post('/api/employees', async ({ request, body }) => {
    const user = currentUser(request)
    if (!user) return unauthorized()
    if (!canEdit(user)) return forbidden('Role Anda tidak boleh menambah karyawan.')

    const payload =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {}
    const nama = strParam(payload.nama)
    const division = strParam(payload.division)
    if (!nama) return jsonError(400, 'Nama wajib diisi')
    if (!division) return jsonError(400, 'Divisi wajib diisi')

    // Phase 1: validate/coerce everything BEFORE touching the transaction so
    // a bad field can never leave an open tx behind.
    const extras: Array<{ col: string; kind: ColumnKind; value: unknown }> = []
    for (const [col, kindRaw] of Object.entries(EMPLOYEE_COLUMNS)) {
      if (col === 'nama' || col === 'division') continue
      if (!(col in payload)) continue
      const kind = kindRaw as ColumnKind
      const coerced = coerceValue(kind, payload[col])
      if (!coerced.ok) return jsonError(400, `Nilai tidak valid untuk ${col}`)
      extras.push({ col, kind, value: coerced.value })
    }

    const cols: string[] = ['nama', 'division', 'created_by', 'updated_by', ...extras.map((e) => e.col)]
    const values: string[] = ['@nama', '@division', '@created_by', '@updated_by', ...extras.map((e) => `@${e.col}`)]
    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const req = tx.request()
      req.input('nama', sql.NVarChar(200), nama)
      req.input('division', sql.NVarChar(50), division)
      req.input('created_by', sql.NVarChar(100), user.name || user.email)
      req.input('updated_by', sql.NVarChar(100), user.name || user.email)
      for (const e of extras) req.input(e.col, sqlTypeFor(e.kind), e.value)

      const inserted = await req.query(
        `INSERT ${TABLE} (${cols.join(', ')}) OUTPUT INSERTED.id VALUES (${values.join(', ')})`,
      )
      const newId = Number(inserted.recordset[0]?.id)
      await writeAudit(tx, {
        employeeId: newId,
        employeeName: nama,
        action: 'create',
        newValue: nama,
        changedBy: user.name || user.email,
      })
      await tx.commit()
      return jsonOk({ success: true, id: newId })
    } catch (err) {
      await tx.rollback().catch(() => {})
      console.error('[manual:create]', err)
      return jsonError(500, 'Gagal menambah karyawan')
    }
  })

  // ── Update (per-field audit diff) ───────────────────────────────────────
  app.patch('/api/employees/:id', async ({ params, request, body }) => {
    const user = currentUser(request)
    if (!user) return unauthorized()
    if (!canEdit(user)) return forbidden('Role Anda tidak boleh mengubah data karyawan.')

    const id = Number(params.id)
    if (!Number.isInteger(id)) return jsonError(400, 'id tidak valid')
    const payload =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {}

    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const current = await tx
        .request()
        .input('id', sql.Int, id)
        .query(`SELECT ${SELECT_COLS} FROM ${TABLE} WHERE id = @id`)
      const row = current.recordset[0]
      if (!row) {
        await tx.rollback()
        return jsonError(404, 'Karyawan tidak ditemukan')
      }

      const sets: string[] = []
      const auditRows: Array<{ field: string; oldValue: unknown; newValue: unknown }> = []
      const req = tx.request()
      req.input('id', sql.Int, id)

      for (const [col, kind] of Object.entries(EMPLOYEE_COLUMNS)) {
        if (!(col in payload)) continue
        const coerced = coerceValue(kind as ColumnKind, payload[col])
        if (!coerced.ok) {
          await tx.rollback()
          return jsonError(400, `Nilai tidak valid untuk ${col}`)
        }
        const before = row[col]
        const beforeNorm = before instanceof Date ? before : before ?? null
        const afterNorm = coerced.value
        // Compare as strings so '4000000' vs 4000000 is not a phantom diff.
        if (display(beforeNorm) === display(afterNorm)) continue
        sets.push(`${col} = @${col}`)
        req.input(col, sqlTypeFor(kind as ColumnKind), afterNorm)
        auditRows.push({ field: col, oldValue: beforeNorm, newValue: afterNorm })
      }

      if (sets.length) {
        req.input('updated_by', sql.NVarChar(100), user.name || user.email)
        const upd = await req.query(
          `UPDATE ${TABLE} SET ${sets.join(', ')}, updated_by = @updated_by, updated_at = GETDATE()
           WHERE id = @id`,
        )
        if (!upd.rowsAffected?.[0]) {
          // row vanished concurrently — do not commit audit rows for nothing
          await tx.rollback()
          return jsonError(404, 'Karyawan tidak ditemukan')
        }
        for (const a of auditRows) {
          await writeAudit(tx, {
            employeeId: id,
            employeeName: String(row.nama ?? ''),
            action: 'update',
            field: a.field,
            oldValue: display(a.oldValue),
            newValue: display(a.newValue),
            changedBy: user.name || user.email,
          })
        }
      }
      await tx.commit()

      const fresh = await pool
        .request()
        .input('id', sql.Int, id)
        .query(`SELECT ${SELECT_COLS} FROM ${TABLE} WHERE id = @id`)
      return jsonOk({ success: true, item: fresh.recordset[0], changed: auditRows.length })
    } catch (err) {
      await tx.rollback().catch(() => {})
      console.error('[manual:update]', err)
      return jsonError(500, 'Gagal mengubah karyawan')
    }
  })

  // ── Delete (admin / superadmin / hrd only) ──────────────────────────────
  app.delete('/api/employees/:id', async ({ params, request }) => {
    const user = currentUser(request)
    if (!user) return unauthorized()
    if (!canDelete(user)) return forbidden('Hanya Admin/HRD yang boleh menghapus karyawan.')

    const id = Number(params.id)
    if (!Number.isInteger(id)) return jsonError(400, 'id tidak valid')

    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const current = await tx
        .request()
        .input('id', sql.Int, id)
        .query(`SELECT id, nama FROM ${TABLE} WHERE id = @id`)
      const row = current.recordset[0]
      if (!row) {
        await tx.rollback()
        return jsonError(404, 'Karyawan tidak ditemukan')
      }
      await tx
        .request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM ${TABLE} WHERE id = @id`)
      await writeAudit(tx, {
        employeeId: id,
        employeeName: String(row.nama ?? ''),
        action: 'delete',
        oldValue: String(row.nama ?? ''),
        changedBy: user.name || user.email,
      })
      await tx.commit()
      return jsonOk({ success: true })
    } catch (err) {
      await tx.rollback().catch(() => {})
      console.error('[manual:delete]', err)
      return jsonError(500, 'Gagal menghapus karyawan')
    }
  })

  // ── Audit trail ─────────────────────────────────────────────────────────
  app.get('/api/changes', async ({ query }) => {
    const limit = intParam(query.limit, 50, 200)
    const sinceId = intParam(query.since, 0, 2_000_000_000)
    const employeeId = intParam(query.employee_id, 0, 2_000_000_000)
    const where: string[] = ['id > @since']
    const pool = await getPool()
    const req = pool.request().input('since', sql.Int, sinceId)
    if (employeeId) {
      where.push('employee_id = @employee_id')
      req.input('employee_id', sql.Int, employeeId)
    }
    const r = await req.input('limit', sql.Int, limit).query(
      `SELECT TOP (@limit) id, employee_id, employee_name, action, field, old_value, new_value, changed_by, changed_at
       FROM ${CHANGES}
       WHERE ${where.join(' AND ')}
       ORDER BY id DESC`,
    )
    return jsonOk({ items: r.recordset, since: sinceId })
  })

  // ── Meta: divisions + counts + watermark (dashboard/poll bootstrap) ─────
  app.get('/api/meta', async () => {
    const pool = await getPool()
    const [counts, watermark, statuses] = await Promise.all([
      pool
        .request()
        .query(`SELECT division, COUNT(*) AS count FROM ${TABLE} GROUP BY division ORDER BY division`),
      pool.request().query(`SELECT COUNT(*) AS total, MAX(updated_at) AS watermark FROM ${TABLE}`),
      pool
        .request()
        .query(
          `SELECT TOP 20 status, COUNT(*) AS count FROM ${TABLE} WHERE status IS NOT NULL GROUP BY status ORDER BY COUNT(*) DESC`,
        ),
    ])
    const w = watermark.recordset[0] ?? {}
    return jsonOk({
      divisions: counts.recordset.map((r) => ({ division: r.division, count: Number(r.count) })),
      statuses: statuses.recordset.map((r) => ({ status: r.status, count: Number(r.count) })),
      total: Number(w.total ?? 0),
      watermark: w.watermark ? new Date(w.watermark).getTime() : 0,
    })
  })

  // ── Dashboard: headline stats for the overview page ─────────────────────
  app.get('/api/dashboard', async () => {
    const pool = await getPool()
    const [head, byGender, byDivision, recent] = await Promise.all([
      pool.request().query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN gender = 'LK' THEN 1 ELSE 0 END) AS lk,
                SUM(CASE WHEN gender = 'PR' THEN 1 ELSE 0 END) AS pr,
                SUM(CASE WHEN tanggal_masuk >= DATEADD(DAY, -30, GETDATE()) THEN 1 ELSE 0 END) AS new30,
                MAX(updated_at) AS watermark
         FROM ${TABLE}`,
      ),
      pool.request().query(
        `SELECT gender, COUNT(*) AS count FROM ${TABLE} WHERE gender IS NOT NULL GROUP BY gender`,
      ),
      pool.request().query(
        `SELECT division, COUNT(*) AS count FROM ${TABLE} GROUP BY division ORDER BY COUNT(*) DESC`,
      ),
      pool.request().query(
        `SELECT TOP 10 id, employee_name, action, field, old_value, new_value, changed_by, changed_at
         FROM ${CHANGES} ORDER BY id DESC`,
      ),
    ])
    const h = head.recordset[0] ?? {}
    return jsonOk({
      total: Number(h.total ?? 0),
      lk: Number(h.lk ?? 0),
      pr: Number(h.pr ?? 0),
      new30: Number(h.new30 ?? 0),
      watermark: h.watermark ? new Date(h.watermark).getTime() : 0,
      byGender: byGender.recordset,
      byDivision: byDivision.recordset.map((r) => ({ division: r.division, count: Number(r.count) })),
      recentChanges: recent.recordset,
    })
  })

  return app
}
