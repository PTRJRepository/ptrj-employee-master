/**
 * scripts/schema.ts — creates the manual master tables in extend_db_ptrj.
 * Idempotent: IF OBJECT_ID guards on every statement.
 *
 * Run: bun scripts/schema.ts
 */
import { getPool, closePool } from '../src/lib/db/pool'

const DDL = `
IF OBJECT_ID('dbo.EMPLOYEE_MASTER', 'U') IS NULL
CREATE TABLE dbo.EMPLOYEE_MASTER (
  id                    INT IDENTITY(1,1) PRIMARY KEY,
  division              NVARCHAR(50)   NOT NULL,
  sub_divisi            NVARCHAR(200)  NULL,
  no                    INT            NULL,
  nama                  NVARCHAR(200)  NOT NULL,
  status                NVARCHAR(50)   NULL,
  status2               NVARCHAR(50)   NULL,
  gender                NVARCHAR(4)    NULL,
  jabatan               NVARCHAR(150)  NULL,
  catatan               NVARCHAR(4000) NULL,
  tanggal_masuk         DATE           NULL,
  tanggal_lahir         DATE           NULL,
  tempat_lahir          NVARCHAR(200)  NULL,
  no_ktp                NVARCHAR(40)   NULL,
  no_kk                 NVARCHAR(40)   NULL,
  no_rekening           NVARCHAR(50)   NULL,
  no_bpjs_tk            NVARCHAR(50)   NULL,
  gaji_pokok            DECIMAL(18,2)  NULL,
  tunjangan_masa_kerja  DECIMAL(18,2)  NULL,
  gaji_total            DECIMAL(18,2)  NULL,
  upah                  DECIMAL(18,2)  NULL,
  bpjs_kesehatan        NVARCHAR(100)  NULL,
  bpjs_jamsostek        NVARCHAR(100)  NULL,
  nama_ibu              NVARCHAR(300)  NULL,
  nama_suami_istri      NVARCHAR(300)  NULL,
  nama_anak             NVARCHAR(2000) NULL,
  agama                 NVARCHAR(50)   NULL,
  pendidikan            NVARCHAR(100)  NULL,
  alamat                NVARCHAR(1000) NULL,
  domisili              NVARCHAR(100)  NULL,
  created_by            NVARCHAR(100)  NULL,
  updated_by            NVARCHAR(100)  NULL,
  created_at            DATETIME2      NOT NULL DEFAULT GETDATE(),
  updated_at            DATETIME2      NOT NULL DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.EMPLOYEE_CHANGES', 'U') IS NULL
CREATE TABLE dbo.EMPLOYEE_CHANGES (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  employee_id   INT            NOT NULL,
  employee_name NVARCHAR(200)  NULL,
  action        NVARCHAR(20)   NOT NULL,   -- create | update | delete
  field         NVARCHAR(50)   NULL,
  old_value     NVARCHAR(1000) NULL,
  new_value     NVARCHAR(1000) NULL,
  changed_by    NVARCHAR(100)  NULL,
  changed_at    DATETIME2      NOT NULL DEFAULT GETDATE()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EMPLOYEE_MASTER_division' AND object_id = OBJECT_ID('dbo.EMPLOYEE_MASTER'))
  CREATE INDEX IX_EMPLOYEE_MASTER_division ON dbo.EMPLOYEE_MASTER (division);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EMPLOYEE_MASTER_nama' AND object_id = OBJECT_ID('dbo.EMPLOYEE_MASTER'))
  CREATE INDEX IX_EMPLOYEE_MASTER_nama ON dbo.EMPLOYEE_MASTER (nama);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EMPLOYEE_CHANGES_employee' AND object_id = OBJECT_ID('dbo.EMPLOYEE_CHANGES'))
  CREATE INDEX IX_EMPLOYEE_CHANGES_employee ON dbo.EMPLOYEE_CHANGES (employee_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EMPLOYEE_CHANGES_changed_at' AND object_id = OBJECT_ID('dbo.EMPLOYEE_CHANGES'))
  CREATE INDEX IX_EMPLOYEE_CHANGES_changed_at ON dbo.EMPLOYEE_CHANGES (changed_at);
`

async function main() {
  const pool = await getPool()
  // Schema DDL is the one trusted writer path in this module, executed only
  // by an operator running `bun scripts/schema.ts` (runtime code stays
  // SELECT-only on db_ptrj and parameterized-DML on EMPLOYEE_*).
  await pool.request().query(DDL)

  const check = await pool.request().query(`
    SELECT t.name AS tbl, p.rows AS rows
    FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
    WHERE t.name IN ('EMPLOYEE_MASTER','EMPLOYEE_CHANGES')`)
  for (const r of check.recordset) console.log(`  ${r.tbl}: ${r.rows} rows`)
  console.log('schema OK')
}

main()
  .catch((err) => {
    console.error('schema FAILED:', err)
    process.exitCode = 1
  })
  .finally(() => closePool())
