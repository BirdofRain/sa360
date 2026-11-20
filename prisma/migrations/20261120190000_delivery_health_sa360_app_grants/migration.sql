-- Runtime grants for the delivery-health tables created by
-- 20261120140000_delivery_health_monitoring.
--
-- There is no ALTER DEFAULT PRIVILEGES grant to sa360_app. A table created by
-- the migrate login is not visible to sa360_app until this migration grants it.
-- The migrate login remains the table owner. This block does not SET ROLE,
-- create a role, issue a password, change ownership, or change default privileges.
--
-- sa360_app receives SELECT, INSERT, and UPDATE only. It does not receive
-- DELETE, TRUNCATE, or ALL, and nothing is granted to PUBLIC.
--
-- Loopback databases can migrate before sa360_app exists. This block then
-- grants nothing. A non-loopback session without sa360_app fails.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public."DeliveryHealthIncident",
      public."DeliveryHealthMonitorHeartbeat"
    TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'delivery health grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'delivery health grants refused: sa360_app is absent';
END
$grant$;
