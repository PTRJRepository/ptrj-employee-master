-- Fix menu grants for employee-master portal
-- Adds HRD, PAJAK, MANDOR, AKUNTING to role_service_permission
-- so they can see the "Karyawan (HRD)" tile in the portal sidebar.
--
-- Run against extend_db_ptrj:
--   sqlcmd -S <server> -d extend_db_ptrj -i scripts/fix-menu-grants.sql

SET NOCOUNT ON;

DECLARE @serviceId NVARCHAR(50) = 'employee-master';

-- Roles that need menu grants (currently missing)
DECLARE @roles TABLE (role_name NVARCHAR(50));
INSERT INTO @roles (role_name) VALUES
    ('HRD'),
    ('PAJAK'),
    ('MANDOR'),
    ('AKUNTING');

-- Insert missing grants
INSERT INTO role_service_permission (service_id, role_name, granted)
SELECT @serviceId, r.role_name, 1
FROM @roles r
WHERE NOT EXISTS (
    SELECT 1 FROM role_service_permission
    WHERE service_id = @serviceId AND role_name = r.role_name
);

-- Verify
SELECT role_name, granted
FROM role_service_permission
WHERE service_id = @serviceId
ORDER BY role_name;
