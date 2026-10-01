/**
 * src/routes/sistem.ts — Data Sistem (source 2): read-only browse over the
 * production HR tables in db_ptrj. HARD POLICY: SELECT-only (assertSelectOnly
 * on every statement; db_ptrj is never written — see DB Read-Only Policy).
 *
 * Tables: HR_EMPLOYEE (identity), HR_EMPLOYMENT (job/status), HR_DEPTCODE
 * (dept names), HR_POSITION (position names), HR_EMPFAM (family).
 */
import sql from 'mssql'
import { Elysia } from 'elysia'
import { getPool, assertSelectOnly } from '../lib/db/pool'
import { intParam, strParam, type SqlBindType } from './common'
import { jsonError, jsonOk } from '../lib/http/json'

const DB = 'db_ptrj.dbo'

/** Run a SELECT-only query against db_ptrj (policy enforced per statement). */
async function estateQuery(text: string, prepare?: (r: sql.Request) => sql.Request): Promise<sql.IResult<any>> {
  assertSelectOnly(text)
  const pool = await getPool()
  const req = pool.request()
  const prepared = prepare ? prepare(req) : req
  return prepared.query(text)
}

/** HR code → label. Gender is stored as '1'/'2' in HR_EMPLOYEE. */
function genderLabel(code: unknown): string {
  const c = String(code ?? '').trim()
  if (c === '1') return 'LK'
  if (c === '2') return 'PR'
  return ''
}

/** Active = never terminated, or sentinel 1900-01-01 date (SAP-era default). */
const ACTIVE_PREDICATE = `(em.TerminateDate IS NULL OR em.TerminateDate < '1901-01-01')`

export function sistemRoutes(): Elysia {
  const app = new Elysia()
  // ── List (search / dept filter / active filter / paginate) ──────────────
  app.get('/api/sistem/employees', async ({ query }) => {
    const q = strParam(query.q)
    const dept = strParam(query.dept)
    const active = strParam(query.active) // '' = all, 'Y' = active only, 'N' = terminated
    const page = intParam(query.page, 1, 1_000_000)
    const limit = intParam(query.limit, 50, 500)

    // Build WHERE clauses + binds once; apply identically to count & page.
    const clauses: string[] = []
    const binds: Array<{ name: string; type: SqlBindType; value: unknown }> = []
    if (q) {
      clauses.push(`(e.EmpName LIKE @q OR LTRIM(RTRIM(e.EmpCode)) LIKE @q OR e.NewICNo LIKE @q OR e.ResAddress LIKE @q)`)
      binds.push({ name: 'q', type: sql.NVarChar, value: `%${q}%` })
    }
    if (dept) {
      clauses.push(`LTRIM(RTRIM(em.DeptCode)) = @dept`)
      binds.push({ name: 'dept', type: sql.NVarChar, value: dept })
    }
    if (active === 'Y') clauses.push(ACTIVE_PREDICATE)
    if (active === 'N') clauses.push(`NOT (${ACTIVE_PREDICATE})`)
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const bindAll = (req: sql.Request): sql.Request => {
      for (const b of binds) req.input(b.name, b.type, b.value)
      return req
    }

    const countSql = `SELECT COUNT(*) AS total FROM ${DB}.HR_EMPLOYEE e
      LEFT JOIN ${DB}.HR_EMPLOYMENT em ON em.EmpCode = e.EmpCode ${whereSql}`
    const pageSql = `
      SELECT LTRIM(RTRIM(e.EmpCode)) AS emp_code, e.EmpName, e.Gender, e.NewICNo, e.DOB,
             e.Religion, e.MaritalStatus, e.Status, e.MobileTel, e.ResAddress,
             e.PlaceOfBirth, e.HREmpType,
             em.AppJoinDate, em.TerminateDate, em.DeptCode, em.PosCode, em.LocCode,
             em.LevelCode, em.SalSchemeCode, em.SalGradeCode,
             CASE WHEN ${ACTIVE_PREDICATE} THEN 1 ELSE 0 END AS is_active,
             d.Description AS dept_name, p.Description AS pos_name
      FROM ${DB}.HR_EMPLOYEE e
      LEFT JOIN ${DB}.HR_EMPLOYMENT em ON em.EmpCode = e.EmpCode
      LEFT JOIN ${DB}.HR_DEPTCODE d ON LTRIM(RTRIM(d.DeptCode)) = LTRIM(RTRIM(em.DeptCode))
      LEFT JOIN ${DB}.HR_POSITION p ON LTRIM(RTRIM(p.PositionCode)) = LTRIM(RTRIM(em.PosCode))
      ${whereSql}
      ORDER BY e.EmpName
      OFFSET @offset ROWS FETCH NEXT @fetch ROWS ONLY`

    const countR = await estateQuery(countSql, bindAll)
    const pageR = await estateQuery(pageSql, (req) =>
      bindAll(req).input('offset', sql.Int, (page - 1) * limit).input('fetch', sql.Int, limit),
    )

    const total = Number(countR.recordset[0]?.total ?? 0)
    const items = (pageR.recordset ?? []).map((r) => ({ ...r, gender_label: genderLabel(r.Gender) }))
    return jsonOk({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  })

  // ── Detail: identity + employment + family ──────────────────────────────
  app.get('/api/sistem/employees/:code', async ({ params }) => {
    const code = strParam(params.code)
    if (!code) return jsonError(400, 'Kode karyawan tidak valid')

    const emp = await estateQuery(
      `SELECT TOP 1 LTRIM(RTRIM(e.EmpCode)) AS emp_code, e.EmpName, e.Gender, e.NewICNo, e.OldICNo,
              e.DOB, e.Religion, e.MaritalStatus, e.Status, e.MobileTel, e.ResAddress, e.PostAddress,
              e.PlaceOfBirth, e.BloodType, e.Race, e.Nation, e.HREmpType,
              em.AppJoinDate, em.AppJoinGrpDate, em.TerminateDate, em.ConfirmDate,
              em.DeptCode, em.PosCode, em.LocCode, em.LevelCode,
              em.SalSchemeCode, em.SalGradeCode, em.Probation, em.Remark, em.IsGangLeader,
              CASE WHEN ${ACTIVE_PREDICATE} THEN 1 ELSE 0 END AS is_active,
              d.Description AS dept_name, p.Description AS pos_name
       FROM ${DB}.HR_EMPLOYEE e
       LEFT JOIN ${DB}.HR_EMPLOYMENT em ON em.EmpCode = e.EmpCode
       LEFT JOIN ${DB}.HR_DEPTCODE d ON LTRIM(RTRIM(d.DeptCode)) = LTRIM(RTRIM(em.DeptCode))
       LEFT JOIN ${DB}.HR_POSITION p ON LTRIM(RTRIM(p.PositionCode)) = LTRIM(RTRIM(em.PosCode))
       WHERE LTRIM(RTRIM(e.EmpCode)) = @code`,
      (req) => req.input('code', sql.NVarChar(50), code),
    )
    const item = emp.recordset[0]
    if (!item) return jsonError(404, 'Karyawan tidak ditemukan di db_ptrj')
    item.gender_label = genderLabel(item.Gender)

    const fam = await estateQuery(
      `SELECT TOP 50 FamilyID, FamName, Gender, Relationship, DOB, TelNo, WorkInd, Remark
       FROM ${DB}.HR_EMPFAM
       WHERE LTRIM(RTRIM(EmpCode)) = @code
       ORDER BY FamilyID`,
      (req) => req.input('code', sql.NVarChar(50), code),
    )

    return jsonOk({ item, family: fam.recordset ?? [] })
  })

  // ── Departments (with headcount) ────────────────────────────────────────
  app.get('/api/sistem/depts', async () => {
    const r = await estateQuery(
      `SELECT LTRIM(RTRIM(d.DeptCode)) AS dept_code, d.Description AS dept_name, d.Status,
              COUNT(em.EmpCode) AS headcount
       FROM ${DB}.HR_DEPTCODE d
       LEFT JOIN ${DB}.HR_EMPLOYMENT em ON LTRIM(RTRIM(em.DeptCode)) = LTRIM(RTRIM(d.DeptCode))
         AND ${ACTIVE_PREDICATE}
       GROUP BY LTRIM(RTRIM(d.DeptCode)), d.Description, d.Status
       ORDER BY COUNT(em.EmpCode) DESC, LTRIM(RTRIM(d.DeptCode))`,
    )
    return jsonOk({
      items: (r.recordset ?? []).map((x) => ({
        ...x,
        dept_name: String(x.dept_name ?? '').trim(),
      })),
    })
  })

  // ── Dashboard stats for the Data Sistem tab ─────────────────────────────
  app.get('/api/sistem/stats', async () => {
    const [head, byDept, byGender] = await Promise.all([
      estateQuery(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${ACTIVE_PREDICATE} THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN ${ACTIVE_PREDICATE} THEN 0 ELSE 1 END) AS terminated,
                MIN(e.DOB) AS _min_dob
         FROM ${DB}.HR_EMPLOYEE e
         LEFT JOIN ${DB}.HR_EMPLOYMENT em ON em.EmpCode = e.EmpCode`,
      ),
      estateQuery(
        `SELECT TOP 10 LTRIM(RTRIM(em.DeptCode)) AS dept_code, d.Description AS dept_name, COUNT(*) AS count
         FROM ${DB}.HR_EMPLOYMENT em
         LEFT JOIN ${DB}.HR_DEPTCODE d ON LTRIM(RTRIM(d.DeptCode)) = LTRIM(RTRIM(em.DeptCode))
         WHERE ${ACTIVE_PREDICATE}
         GROUP BY LTRIM(RTRIM(em.DeptCode)), d.Description
         ORDER BY COUNT(*) DESC`,
      ),
      estateQuery(
        `SELECT Gender, COUNT(*) AS count FROM ${DB}.HR_EMPLOYEE GROUP BY Gender`,
      ),
    ])
    const h = head.recordset[0] ?? {}
    return jsonOk({
      total: Number(h.total ?? 0),
      active: Number(h.active ?? 0),
      terminated: Number(h.terminated ?? 0),
      byDept: (byDept.recordset ?? []).map((x) => ({
        dept_code: x.dept_code,
        dept_name: String(x.dept_name ?? '').trim(),
        count: Number(x.count),
      })),
      byGender: (byGender.recordset ?? []).map((x) => ({
        gender: genderLabel(x.Gender) || String(x.Gender ?? '').trim(),
        count: Number(x.count),
      })),
    })
  })

  return app
}
