-- Function-install checker. Inert. Do not copy into prisma/migrations.
--
-- Run this before functions.sql, after Boundary A has created the owner and
-- runtime roles. It does not create roles, grant, revoke, or install anything.
-- A failure raises. A pass rolls back. It does not read customer rows and it
-- does not print credentials.
--
-- The included preconditions.sql raises when those roles are absent. Do not
-- use this file to inspect the current unprepared production database. The
-- read-only catalog pass before Boundary A is inspect-before-boundary-a.sql.
-- This file adds the checks that are true only before function installation:
-- no summary routine and no summary trigger may already exist.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

DO $preflight$
BEGIN
  IF current_user = 'sa360_app' OR current_user = 'sa360_summary_runtime' THEN
    RAISE EXCEPTION 'preflight refused: runtime session cannot inspect an install';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proname LIKE 'historical_catalog_summary_%'
  ) THEN
    RAISE EXCEPTION 'preflight refused: a summary routine is already installed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    WHERE NOT trigger.tgisinternal
      AND trigger.tgname LIKE 'historical_catalog_summary_%'
  ) THEN
    RAISE EXCEPTION 'preflight refused: a summary trigger is already installed';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_trigger AS trigger
    WHERE NOT trigger.tgisinternal
      AND trigger.tgname LIKE 'historical_catalog_projection_%'
      AND trigger.tgenabled = 'O'
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'preflight refused: projection triggers must stay enabled';
  END IF;

  IF to_regclass('public.historical_catalog_summary_control') IS NULL THEN
    RAISE EXCEPTION 'preflight refused: summary control table is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM public.historical_catalog_summary_control
    WHERE singleton AND summary_ready = false
  ) IS DISTINCT FROM 1
  OR (SELECT count(*) FROM public.historical_catalog_summary_control) IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'preflight refused: summary control must be exactly one unready row';
  END IF;
END
$preflight$;

ROLLBACK;

\ir preconditions.sql
