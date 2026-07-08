-- Reconcile sa360CustomFieldOptionMapJson after ClientGhlDestination exists.
-- No-op when the column was already added by the guarded 20260601120000 migration on upgraded databases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ClientGhlDestination'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ClientGhlDestination'
      AND column_name = 'sa360CustomFieldOptionMapJson'
  ) THEN
    ALTER TABLE "ClientGhlDestination"
    ADD COLUMN "sa360CustomFieldOptionMapJson" JSONB NOT NULL DEFAULT '{}';
  END IF;
END $$;
