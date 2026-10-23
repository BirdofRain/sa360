-- Historical campaign summary maintenance, boundary A.
--
-- Inert candidate. Do not copy this file into prisma/migrations.
-- Installing these functions does not attach triggers and does not change
-- inventory, source-event, projection, fulfillment, or resale writes.
-- Do not execute these functions against production in this gate.
--
-- Boundary B is triggers.sql. A future install must apply that file only
-- after a separate approval. Applying both in one automatic migration is
-- not allowed.
--
-- The item projection and its three triggers stay authoritative. This file
-- does not replace historical_catalog_projection_refresh_item and does not
-- add a trigger on historical_catalog_projection. A lot-key rename must not
-- rebucket the lot inside the rename transaction.
--
-- Lock order for one apply:
--   1. item advisory locks (8142003), ordered by hashtext(item_id), item_id
--   2. label advisory locks (8142002), ordered by hashtext(label_hash), label_hash
--   3. membership FOR UPDATE, ordered by item_id
--   4. grain advisory locks (8142004), ordered by hashtext(grain token),
--      then bucket FOR UPDATE, ordered by bucket_id
-- The grain advisory lock is taken before any bucket insert. An insert locks
-- its new row immediately, so inserting before a shared order can deadlock
-- two sessions that also need each other's existing buckets.
--
-- A failed apply rolls its bucket delta back in a subtransaction, then marks
-- the summary unready. The authoritative write may commit only when that
-- control update changes the single row. A missing or locked control row
-- re-raises, so the inventory statement, the projection refresh, and the
-- summary delta all roll back.
--
-- statement_timeout (57014) and other query cancellations are not caught.
-- PostgreSQL aborts the whole statement before PL/pgSQL can handle them.
--
-- There is no fault-injection GUC in this file.

CREATE FUNCTION historical_catalog_summary_chunk_cap()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT 500
$fn$;

CREATE FUNCTION historical_catalog_summary_label_token(p_july text, p_normalized text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE
           WHEN p_july IS NULL THEN 'N'
           ELSE 'V' || octet_length(p_july)::text || ':' || p_july
         END
      || E'\x1f'
      || CASE
           WHEN p_normalized IS NULL THEN 'N'
           ELSE 'V' || octet_length(p_normalized)::text || ':' || p_normalized
         END
$fn$;

-- Maps an error to a stored token. The token is the allowlist. SQLERRM is
-- never stored, because it can contain labels or item ids.
CREATE FUNCTION historical_catalog_summary_failure_reason(p_sqlstate text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE p_sqlstate
           WHEN '40P01' THEN 'deadlock_detected'
           WHEN '55P03' THEN 'lock_not_available'
           WHEN '57014' THEN 'query_canceled'
           WHEN 'SB001' THEN 'bucket_vanished'
           WHEN 'SB004' THEN 'bucket_underflow'
           WHEN 'SB005' THEN 'grain_too_long'
           WHEN 'SB006' THEN 'label_unresolved'
           WHEN '23505' THEN 'unique_violation'
           WHEN '23514' THEN 'check_violation'
           WHEN '23503' THEN 'foreign_key_violation'
           WHEN '54000' THEN 'index_row_too_large'
           ELSE 'sqlstate_' || upper(p_sqlstate)
         END
$fn$;

CREATE FUNCTION historical_catalog_summary_mark_unready(
  p_reason text,
  p_count_failure boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_marked integer;
BEGIN
  IF p_reason IS NULL
     OR (
       p_reason NOT IN (
         'lot_key_rename',
         'maintenance',
         'reconcile_failed',
         'authorize_rejected',
         'deadlock_detected',
         'lock_not_available',
         'query_canceled',
         'bucket_vanished',
         'bucket_underflow',
         'grain_too_long',
         'label_unresolved',
         'unique_violation',
         'check_violation',
         'foreign_key_violation',
         'index_row_too_large',
         'membership_incomplete'
       )
       AND p_reason !~ '^sqlstate_[0-9A-Z]{5}$'
     )
  THEN
    RAISE EXCEPTION 'summary invalidation reason is not allowlisted'
      USING ERRCODE = 'SB007';
  END IF;

  UPDATE historical_catalog_summary_control
  SET
    summary_ready = false,
    summary_epoch = summary_epoch + 1,
    invalidated_at = clock_timestamp(),
    invalidation = p_reason,
    failure_count = failure_count + CASE WHEN p_count_failure THEN 1 ELSE 0 END
  WHERE singleton;
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  IF v_marked <> 1 THEN
    RAISE EXCEPTION 'summary control row missing; rolling back authoritative write'
      USING ERRCODE = 'SB008';
  END IF;
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_label_id(p_july text, p_normalized text)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_hash text;
  v_id bigint;
BEGIN
  v_hash := md5(historical_catalog_summary_label_token(p_july, p_normalized));
  PERFORM pg_advisory_xact_lock(8142002, hashtext(v_hash));
  SELECT label_pair_id
  INTO v_id
  FROM historical_catalog_summary_label
  WHERE label_hash = v_hash
    AND july_label IS NOT DISTINCT FROM p_july
    AND normalized_label IS NOT DISTINCT FROM p_normalized;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  INSERT INTO historical_catalog_summary_label (july_label, normalized_label, label_hash)
  VALUES (p_july, p_normalized, v_hash)
  RETURNING label_pair_id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- One attempt. Caller retries only a vanished bucket or a deadlock, and only
-- inside the same transaction. plan_cache_mode stays custom so a generic plan
-- cannot replace the grain index with a sequential scan as cardinality grows.
-- The bucket lookup uses equality. On PostgreSQL 16.15, IS NOT DISTINCT FROM
-- has no btree path and sequential-scans the bucket heap.
CREATE FUNCTION historical_catalog_summary_apply_items_once(p_ids text[])
RETURNS integer
LANGUAGE plpgsql
SET plan_cache_mode = force_custom_plan
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_row record;
  v_epoch bigint;
  v_expected integer;
  v_updated integer;
BEGIN
  FOR v_row IN
    SELECT DISTINCT id AS item_id, hashtext(id) AS lock_key
    FROM unnest(p_ids) AS requested(id)
    ORDER BY lock_key, item_id
  LOOP
    PERFORM pg_advisory_xact_lock(8142003, v_row.lock_key);
  END LOOP;

  INSERT INTO historical_catalog_summary_membership AS membership (item_id, bucket_id, accounted)
  SELECT DISTINCT requested.id, NULL::bigint, false
  FROM unnest(p_ids) AS requested(id)
  ORDER BY 1
  ON CONFLICT (item_id) DO NOTHING;

  -- One row at a time, in item_id order. A single SELECT FOR UPDATE can lock
  -- in scan order when a Sort sits above LockRows.
  FOR v_row IN
    SELECT membership.item_id
    FROM unnest(p_ids) AS requested(id)
    JOIN historical_catalog_summary_membership AS membership
      ON membership.item_id = requested.id
    ORDER BY membership.item_id
  LOOP
    PERFORM 1
    FROM historical_catalog_summary_membership AS membership
    WHERE membership.item_id = v_row.item_id
    FOR UPDATE;
  END LOOP;

  IF to_regclass('summary_apply_desired') IS NOT NULL THEN
    DROP TABLE summary_apply_desired;
  END IF;
  CREATE TEMP TABLE summary_apply_desired (
    item_id text PRIMARY KEY,
    old_bucket_id bigint,
    old_accounted boolean NOT NULL,
    has_projection boolean NOT NULL,
    label_pair_id bigint,
    new_bucket_id bigint,
    lot_key text,
    raw_lot_key text,
    import_request text,
    normalized_label text,
    july_label text,
    origin_id text,
    niche_key text,
    raw_niche_key text,
    item_status text,
    label_agreement text
  ) ON COMMIT DROP;

  INSERT INTO summary_apply_desired (
    item_id, old_bucket_id, old_accounted, has_projection,
    lot_key, raw_lot_key, import_request, normalized_label, july_label,
    origin_id, niche_key, raw_niche_key, item_status, label_agreement
  )
  SELECT
    membership.item_id,
    membership.bucket_id,
    membership.accounted,
    projection.item_id IS NOT NULL,
    projection.lot_key,
    lot."lotKey",
    projection.import_request,
    projection.normalized_label,
    projection.july_label,
    projection.origin_id,
    projection.niche_key,
    item."nicheKey",
    projection.item_status,
    projection.label_agreement
  FROM unnest(p_ids) AS requested(id)
  JOIN historical_catalog_summary_membership AS membership
    ON membership.item_id = requested.id
  LEFT JOIN historical_catalog_projection AS projection
    ON projection.item_id = membership.item_id
  LEFT JOIN "LeadInventoryItem" AS item
    ON item.id = membership.item_id
  LEFT JOIN "InventoryLot" AS lot
    ON lot.id = item."inventoryLotId";

  IF (SELECT count(*) FROM summary_apply_desired)
     <> (SELECT count(DISTINCT id) FROM unnest(p_ids) AS requested(id)) THEN
    RAISE EXCEPTION 'summary membership lock did not cover every item';
  END IF;

  -- The grain unique index includes every text grain column plus label_pair_id.
  -- btree rejects an index tuple around 2704 bytes (54000). 2400 leaves room
  -- for the bigint and index overhead. July text is not in this index.
  IF EXISTS (
    SELECT 1
    FROM summary_apply_desired
    WHERE has_projection
      AND (
        octet_length(coalesce(lot_key, ''))
        + octet_length(coalesce(raw_lot_key, ''))
        + octet_length(coalesce(import_request, ''))
        + octet_length(coalesce(origin_id, ''))
        + octet_length(coalesce(niche_key, ''))
        + octet_length(coalesce(raw_niche_key, ''))
        + octet_length(coalesce(item_status, ''))
        + octet_length(coalesce(label_agreement, ''))
      ) > 2400
  ) THEN
    RAISE EXCEPTION 'summary grain exceeds the 2400-byte btree budget'
      USING ERRCODE = 'SB005';
  END IF;

  FOR v_row IN
    SELECT
      pairs.july_label,
      pairs.normalized_label,
      md5(historical_catalog_summary_label_token(pairs.july_label, pairs.normalized_label)) AS label_hash,
      hashtext(md5(historical_catalog_summary_label_token(pairs.july_label, pairs.normalized_label))) AS lock_key
    FROM (
      SELECT DISTINCT desired.july_label, desired.normalized_label
      FROM summary_apply_desired AS desired
      WHERE desired.has_projection
    ) AS pairs
    ORDER BY lock_key, label_hash
  LOOP
    PERFORM historical_catalog_summary_label_id(v_row.july_label, v_row.normalized_label);
  END LOOP;

  UPDATE summary_apply_desired AS desired
  SET label_pair_id = label.label_pair_id
  FROM historical_catalog_summary_label AS label
  WHERE desired.has_projection
    AND label.label_hash = md5(historical_catalog_summary_label_token(desired.july_label, desired.normalized_label))
    AND label.july_label IS NOT DISTINCT FROM desired.july_label
    AND label.normalized_label IS NOT DISTINCT FROM desired.normalized_label;

  IF EXISTS (
    SELECT 1
    FROM summary_apply_desired
    WHERE has_projection
      AND label_pair_id IS NULL
  ) THEN
    RAISE EXCEPTION 'summary label pair was not resolved'
      USING ERRCODE = 'SB006';
  END IF;

  SELECT summary_epoch
  INTO v_epoch
  FROM historical_catalog_summary_control;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'summary control row missing'
      USING ERRCODE = 'SB008';
  END IF;

  FOR v_row IN
    SELECT grains.lock_key
    FROM (
      SELECT DISTINCT
        hashtext(
          CASE WHEN lot_key IS NULL THEN 'N' ELSE 'V' || lot_key END
          || E'\x1e' || CASE WHEN raw_lot_key IS NULL THEN 'N' ELSE 'V' || raw_lot_key END
          || E'\x1e' || CASE WHEN import_request IS NULL THEN 'N' ELSE 'V' || import_request END
          || E'\x1e' || coalesce(label_pair_id::text, 'N')
          || E'\x1e' || CASE WHEN origin_id IS NULL THEN 'N' ELSE 'V' || origin_id END
          || E'\x1e' || CASE WHEN niche_key IS NULL THEN 'N' ELSE 'V' || niche_key END
          || E'\x1e' || CASE WHEN raw_niche_key IS NULL THEN 'N' ELSE 'V' || raw_niche_key END
          || E'\x1e' || CASE WHEN item_status IS NULL THEN 'N' ELSE 'V' || item_status END
          || E'\x1e' || CASE WHEN label_agreement IS NULL THEN 'N' ELSE 'V' || label_agreement END
        ) AS lock_key
      FROM summary_apply_desired
      WHERE has_projection
    ) AS grains
    ORDER BY grains.lock_key
  LOOP
    PERFORM pg_advisory_xact_lock(8142004, v_row.lock_key);
  END LOOP;

  INSERT INTO historical_catalog_summary_bucket (
    lot_key, raw_lot_key, import_request, label_pair_id, normalized_label, july_label,
    origin_id, niche_key, raw_niche_key, item_status, label_agreement, n, touched_epoch
  )
  SELECT DISTINCT ON (
    lot_key, raw_lot_key, import_request, label_pair_id, origin_id,
    niche_key, raw_niche_key, item_status, label_agreement
  )
    lot_key, raw_lot_key, import_request, label_pair_id, normalized_label, july_label,
    origin_id, niche_key, raw_niche_key, item_status, label_agreement, 0, v_epoch
  FROM summary_apply_desired
  WHERE has_projection
  ORDER BY
    lot_key, raw_lot_key, import_request, label_pair_id, origin_id,
    niche_key, raw_niche_key, item_status, label_agreement
  ON CONFLICT ON CONSTRAINT historical_catalog_summary_bucket_grain DO NOTHING;

  -- Equality, not IS NOT DISTINCT FROM. On PostgreSQL 16.15 the distinct
  -- form has no index path and sequential-scans the bucket heap. Equality
  -- uses historical_catalog_summary_bucket_grain. origin_id is the nullable
  -- grain column that intake actually produces; NULL matches NULL, and ''
  -- does not match NULL. raw lot and raw niche come from NOT NULL columns
  -- while the item still exists.
  UPDATE summary_apply_desired AS desired
  SET new_bucket_id = bucket.bucket_id
  FROM historical_catalog_summary_bucket AS bucket
  WHERE desired.has_projection
    AND bucket.lot_key = desired.lot_key
    AND bucket.raw_lot_key = desired.raw_lot_key
    AND bucket.import_request = desired.import_request
    AND bucket.label_pair_id = desired.label_pair_id
    AND bucket.niche_key = desired.niche_key
    AND bucket.raw_niche_key = desired.raw_niche_key
    AND bucket.item_status = desired.item_status
    AND bucket.label_agreement = desired.label_agreement
    AND (
      (desired.origin_id IS NULL AND bucket.origin_id IS NULL)
      OR bucket.origin_id = desired.origin_id
    );

  IF EXISTS (
    SELECT 1
    FROM summary_apply_desired
    WHERE has_projection
      AND new_bucket_id IS NULL
  ) THEN
    RAISE EXCEPTION 'summary bucket vanished'
      USING ERRCODE = 'SB001';
  END IF;

  -- Same bucket and already accounted: do not lock or rewrite the hot row.
  IF NOT EXISTS (
    SELECT 1
    FROM summary_apply_desired
    WHERE old_bucket_id IS DISTINCT FROM new_bucket_id
       OR old_accounted IS DISTINCT FROM (new_bucket_id IS NOT NULL)
  ) THEN
    RETURN (SELECT count(*)::integer FROM summary_apply_desired);
  END IF;

  FOR v_row IN
    SELECT ids.bucket_id
    FROM (
      SELECT desired.old_bucket_id AS bucket_id
      FROM summary_apply_desired AS desired
      WHERE desired.old_accounted
        AND desired.old_bucket_id IS NOT NULL
      UNION
      SELECT desired.new_bucket_id
      FROM summary_apply_desired AS desired
      WHERE desired.new_bucket_id IS NOT NULL
    ) AS ids
    ORDER BY ids.bucket_id
  LOOP
    PERFORM 1
    FROM historical_catalog_summary_bucket AS bucket
    WHERE bucket.bucket_id = v_row.bucket_id
    FOR UPDATE;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM summary_apply_desired AS desired
    WHERE desired.new_bucket_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM historical_catalog_summary_bucket AS bucket
        WHERE bucket.bucket_id = desired.new_bucket_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM summary_apply_desired AS desired
    WHERE desired.old_accounted
      AND desired.old_bucket_id IS NOT NULL
      AND desired.old_bucket_id IS DISTINCT FROM desired.new_bucket_id
      AND NOT EXISTS (
        SELECT 1
        FROM historical_catalog_summary_bucket AS bucket
        WHERE bucket.bucket_id = desired.old_bucket_id
      )
  ) THEN
    RAISE EXCEPTION 'summary bucket vanished'
      USING ERRCODE = 'SB001';
  END IF;

  IF to_regclass('summary_apply_delta') IS NOT NULL THEN
    DROP TABLE summary_apply_delta;
  END IF;
  CREATE TEMP TABLE summary_apply_delta ON COMMIT DROP AS
  SELECT bucket_id, sum(delta)::integer AS delta
  FROM (
    SELECT old_bucket_id AS bucket_id, -1 AS delta
    FROM summary_apply_desired
    WHERE old_accounted
      AND old_bucket_id IS NOT NULL
      AND old_bucket_id IS DISTINCT FROM new_bucket_id
    UNION ALL
    SELECT new_bucket_id, 1
    FROM summary_apply_desired
    WHERE new_bucket_id IS NOT NULL
      AND (NOT old_accounted OR old_bucket_id IS DISTINCT FROM new_bucket_id)
  ) AS moves
  GROUP BY bucket_id
  HAVING sum(delta) <> 0;

  SELECT count(*) INTO v_expected FROM summary_apply_delta;

  UPDATE historical_catalog_summary_bucket AS bucket
  SET
    n = bucket.n + delta.delta,
    touched_epoch = v_epoch
  FROM summary_apply_delta AS delta
  WHERE bucket.bucket_id = delta.bucket_id
    AND bucket.n + delta.delta >= 0;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'summary bucket underflow or missing bucket'
      USING ERRCODE = 'SB004';
  END IF;

  UPDATE historical_catalog_summary_membership AS membership
  SET
    bucket_id = desired.new_bucket_id,
    accounted = desired.new_bucket_id IS NOT NULL,
    applied_at = clock_timestamp()
  FROM summary_apply_desired AS desired
  WHERE membership.item_id = desired.item_id
    AND (
      membership.bucket_id IS DISTINCT FROM desired.new_bucket_id
      OR membership.accounted IS DISTINCT FROM (desired.new_bucket_id IS NOT NULL)
    );

  DELETE FROM historical_catalog_summary_bucket AS bucket
  USING summary_apply_delta AS delta
  WHERE bucket.bucket_id = delta.bucket_id
    AND bucket.n = 0;

  RETURN (SELECT count(*)::integer FROM summary_apply_desired);
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_apply_items_work(p_ids text[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_attempt integer;
  v_applied integer;
  v_cap integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS requested(id) WHERE requested.id IS NULL) THEN
    RAISE EXCEPTION 'summary apply rejects null item ids';
  END IF;

  v_cap := historical_catalog_summary_chunk_cap();
  IF cardinality(p_ids) > v_cap THEN
    RAISE EXCEPTION 'summary apply chunk exceeds % ids', v_cap;
  END IF;

  -- Live source rows that were never historical do not touch buckets or the
  -- control row, and they do not scan a lot.
  IF NOT EXISTS (
    SELECT 1
    FROM unnest(p_ids) AS requested(id)
    JOIN historical_catalog_projection AS projection
      ON projection.item_id = requested.id
  ) AND NOT EXISTS (
    SELECT 1
    FROM unnest(p_ids) AS requested(id)
    JOIN historical_catalog_summary_membership AS membership
      ON membership.item_id = requested.id
    WHERE membership.accounted
  ) THEN
    RETURN 0;
  END IF;

  FOR v_attempt IN 1..3 LOOP
    BEGIN
      v_applied := historical_catalog_summary_apply_items_once(p_ids);
      RETURN v_applied;
    EXCEPTION
      WHEN deadlock_detected THEN
        IF v_attempt = 3 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'summary apply retry % after deadlock_detected', v_attempt;
      WHEN SQLSTATE 'SB001' THEN
        IF v_attempt = 3 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'summary apply retry % after bucket_vanished', v_attempt;
    END;
  END LOOP;
  RAISE EXCEPTION 'summary apply retries exhausted';
END;
$fn$;

-- Trigger entry. The inner block rolls the delta back before the unready
-- mark. The unready mark runs only after those locks are released, so it
-- does not deadlock with a reconcile that already holds the control row and
-- is waiting for a membership share lock.
CREATE FUNCTION historical_catalog_summary_apply_item(p_item_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  BEGIN
    PERFORM historical_catalog_summary_apply_items_work(ARRAY[p_item_id]);
  EXCEPTION
    WHEN OTHERS THEN
      BEGIN
        PERFORM historical_catalog_summary_mark_unready(
          historical_catalog_summary_failure_reason(SQLSTATE),
          true
        );
      EXCEPTION
        WHEN OTHERS THEN
          RAISE;
      END;
  END;
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_item_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM historical_catalog_summary_apply_item(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM historical_catalog_summary_apply_item(NEW.id);
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_event_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_item_id text;
BEGIN
  SELECT item.id
  INTO v_item_id
  FROM "LeadInventoryItem" AS item
  WHERE item."sourceLeadEventId" = NEW.id;
  IF v_item_id IS NOT NULL THEN
    PERFORM historical_catalog_summary_apply_item(v_item_id);
  END IF;
  RETURN NEW;
END;
$fn$;

-- Invalidates readiness once. Does not read or write projection rows and does
-- not walk the lot. The projection lot trigger has already rewritten lot_key.
CREATE FUNCTION historical_catalog_summary_lot_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."lotKey" IS NOT DISTINCT FROM OLD."lotKey" THEN
    RETURN NEW;
  END IF;
  PERFORM historical_catalog_summary_mark_unready('lot_key_rename', false);
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_backfill_chunk(p_after text, p_until text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_ids text[];
  v_count integer;
  v_cap integer;
  v_ready boolean;
BEGIN
  IF p_after IS NULL OR p_until IS NULL OR p_after >= p_until THEN
    RAISE EXCEPTION 'summary backfill requires a non-empty id range';
  END IF;
  SELECT summary_ready INTO v_ready FROM historical_catalog_summary_control;
  IF v_ready IS NULL THEN
    RAISE EXCEPTION 'summary control row missing' USING ERRCODE = 'SB008';
  END IF;
  IF v_ready THEN
    RAISE EXCEPTION 'summary backfill refused while summary_ready';
  END IF;

  PERFORM set_config('statement_timeout', '20s', true);
  v_cap := historical_catalog_summary_chunk_cap();
  SELECT coalesce(array_agg(item_id ORDER BY item_id), ARRAY[]::text[])
  INTO v_ids
  FROM (
    SELECT projection.item_id
    FROM historical_catalog_projection AS projection
    WHERE projection.item_id > p_after
      AND projection.item_id <= p_until
    UNION
    SELECT membership.item_id
    FROM historical_catalog_summary_membership AS membership
    WHERE membership.item_id > p_after
      AND membership.item_id <= p_until
  ) AS ids;
  v_count := cardinality(v_ids);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;
  IF v_count > v_cap THEN
    RAISE EXCEPTION 'summary backfill range exceeds % items', v_cap;
  END IF;
  PERFORM historical_catalog_summary_apply_items_work(v_ids);
  RETURN v_count;
END;
$fn$;

-- Commits a running checkpoint before the chunk, then commits completion.
-- A crash or a chunk error leaves the checkpoint running and rolls the chunk
-- back. Retry supersedes that running row and applies the same ids again.
-- Apply is reconcile-to-projection, so the retry does not double-count.
-- No SET clause. PostgreSQL refuses COMMIT inside a procedure that has one,
-- because the SET would be discarded at the commit boundary.
CREATE PROCEDURE historical_catalog_summary_backfill_range(p_after text, p_until text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_chunk bigint;
  v_count integer;
  v_ready boolean;
  v_marked integer;
BEGIN
  PERFORM set_config('search_path', 'pg_catalog, public', true);
  SELECT summary_ready
  INTO v_ready
  FROM historical_catalog_summary_control
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'summary control row missing' USING ERRCODE = 'SB008';
  END IF;
  IF v_ready THEN
    RAISE EXCEPTION 'summary backfill refused while summary_ready';
  END IF;

  UPDATE historical_catalog_summary_checkpoint
  SET
    status = 'failed',
    finished_at = clock_timestamp(),
    note = 'superseded'
  WHERE range_after = p_after
    AND range_until = p_until
    AND status = 'running';

  INSERT INTO historical_catalog_summary_checkpoint (range_after, range_until, status)
  VALUES (p_after, p_until, 'running')
  RETURNING chunk_id INTO v_chunk;
  COMMIT;

  PERFORM set_config('search_path', 'pg_catalog, public', true);
  v_count := historical_catalog_summary_backfill_chunk(p_after, p_until);
  UPDATE historical_catalog_summary_checkpoint
  SET
    status = 'complete',
    finished_at = clock_timestamp(),
    items_applied = v_count
  WHERE chunk_id = v_chunk
    AND status = 'running';
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  IF v_marked <> 1 THEN
    RAISE EXCEPTION 'summary checkpoint was not running';
  END IF;
  COMMIT;
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_readable()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT (
    SELECT count(*) FROM historical_catalog_summary_control
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM historical_catalog_summary_control AS control
    WHERE control.summary_ready
      AND control.reconciled_epoch IS NOT DISTINCT FROM control.summary_epoch
      AND control.reconciled_at IS NOT NULL
      AND (control.invalidated_at IS NULL OR control.reconciled_at > control.invalidated_at)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM historical_catalog_summary_checkpoint AS checkpoint
    WHERE checkpoint.status = 'running'
  )
$fn$;

CREATE FUNCTION historical_catalog_summary_lock_for_reconcile()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_epoch bigint;
BEGIN
  SELECT summary_epoch
  INTO v_epoch
  FROM historical_catalog_summary_control
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'summary control row missing' USING ERRCODE = 'SB008';
  END IF;
  LOCK TABLE historical_catalog_summary_label IN SHARE MODE;
  LOCK TABLE historical_catalog_summary_membership IN SHARE MODE;
  LOCK TABLE historical_catalog_summary_bucket IN SHARE MODE;
  RETURN v_epoch;
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_reconcile_issues()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_negative bigint;
  v_zero bigint;
  v_duplicate bigint;
  v_duplicate_labels bigint;
  v_bucket_members bigint;
  v_missing_membership bigint;
  v_extra_membership bigint;
  v_field bigint;
  v_raw_lot bigint;
  v_raw_niche bigint;
  v_label bigint;
  v_sum_n bigint;
  v_projection bigint;
  v_accounted bigint;
  v_blocking bigint;
  v_epoch_mismatch boolean;
  v_failure_count bigint;
  v_invalidation text;
  v_open_invalidation boolean;
  v_ok boolean;
BEGIN
  SELECT count(*) INTO v_negative
  FROM historical_catalog_summary_bucket
  WHERE n < 0;

  SELECT count(*) INTO v_zero
  FROM historical_catalog_summary_bucket
  WHERE n = 0;

  SELECT count(*) INTO v_duplicate
  FROM (
    SELECT 1
    FROM historical_catalog_summary_bucket
    GROUP BY
      lot_key, raw_lot_key, import_request, label_pair_id, origin_id,
      niche_key, raw_niche_key, item_status, label_agreement
    HAVING count(*) > 1
  ) AS duplicated;

  SELECT count(*) INTO v_duplicate_labels
  FROM (
    SELECT 1
    FROM historical_catalog_summary_label
    GROUP BY july_label, normalized_label
    HAVING count(*) > 1
  ) AS duplicated_labels;

  SELECT count(*) INTO v_bucket_members
  FROM (
    SELECT bucket.bucket_id, bucket.n, coalesce(members.member_count, 0) AS member_count
    FROM historical_catalog_summary_bucket AS bucket
    FULL JOIN (
      SELECT membership.bucket_id, count(*)::bigint AS member_count
      FROM historical_catalog_summary_membership AS membership
      WHERE membership.accounted
      GROUP BY membership.bucket_id
    ) AS members ON members.bucket_id = bucket.bucket_id
    WHERE bucket.n IS DISTINCT FROM coalesce(members.member_count, 0)
       OR bucket.bucket_id IS NULL
  ) AS mismatched;

  SELECT count(*) INTO v_missing_membership
  FROM historical_catalog_projection AS projection
  WHERE NOT EXISTS (
    SELECT 1
    FROM historical_catalog_summary_membership AS membership
    WHERE membership.item_id = projection.item_id
      AND membership.accounted
  );

  SELECT count(*) INTO v_extra_membership
  FROM historical_catalog_summary_membership AS membership
  WHERE membership.accounted
    AND NOT EXISTS (
      SELECT 1
      FROM historical_catalog_projection AS projection
      WHERE projection.item_id = membership.item_id
    );

  SELECT
    count(*) FILTER (
      WHERE item.id IS NULL
         OR lot.id IS NULL
         OR bucket.lot_key IS DISTINCT FROM projection.lot_key
         OR bucket.import_request IS DISTINCT FROM projection.import_request
         OR bucket.normalized_label IS DISTINCT FROM projection.normalized_label
         OR bucket.july_label IS DISTINCT FROM projection.july_label
         OR bucket.origin_id IS DISTINCT FROM projection.origin_id
         OR bucket.niche_key IS DISTINCT FROM projection.niche_key
         OR bucket.item_status IS DISTINCT FROM projection.item_status
         OR bucket.label_agreement IS DISTINCT FROM projection.label_agreement
         OR bucket.raw_lot_key IS DISTINCT FROM lot."lotKey"
         OR bucket.raw_niche_key IS DISTINCT FROM item."nicheKey"
    ),
    count(*) FILTER (
      WHERE lot.id IS NULL
         OR bucket.raw_lot_key IS DISTINCT FROM lot."lotKey"
    ),
    count(*) FILTER (
      WHERE item.id IS NULL
         OR bucket.raw_niche_key IS DISTINCT FROM item."nicheKey"
    )
  INTO v_field, v_raw_lot, v_raw_niche
  FROM historical_catalog_summary_membership AS membership
  JOIN historical_catalog_summary_bucket AS bucket
    ON bucket.bucket_id = membership.bucket_id
  JOIN historical_catalog_projection AS projection
    ON projection.item_id = membership.item_id
  LEFT JOIN "LeadInventoryItem" AS item
    ON item.id = membership.item_id
  LEFT JOIN "InventoryLot" AS lot
    ON lot.id = item."inventoryLotId"
  WHERE membership.accounted;

  SELECT count(*) INTO v_label
  FROM historical_catalog_summary_bucket AS bucket
  JOIN historical_catalog_summary_label AS label
    ON label.label_pair_id = bucket.label_pair_id
  WHERE bucket.july_label IS DISTINCT FROM label.july_label
     OR bucket.normalized_label IS DISTINCT FROM label.normalized_label;

  SELECT coalesce(sum(n), 0) INTO v_sum_n FROM historical_catalog_summary_bucket;
  SELECT count(*) INTO v_projection FROM historical_catalog_projection;
  SELECT count(*) INTO v_accounted
  FROM historical_catalog_summary_membership
  WHERE accounted;

  SELECT count(*) INTO v_blocking
  FROM historical_catalog_summary_checkpoint AS checkpoint
  WHERE checkpoint.status = 'running'
     OR (checkpoint.status = 'complete' AND checkpoint.finished_at IS NULL)
     OR (
       checkpoint.status = 'failed'
       AND checkpoint.note IS DISTINCT FROM 'superseded'
       AND NOT EXISTS (
         SELECT 1
         FROM historical_catalog_summary_checkpoint AS later
         WHERE later.range_after = checkpoint.range_after
           AND later.range_until = checkpoint.range_until
           AND later.status = 'complete'
           AND later.chunk_id > checkpoint.chunk_id
       )
     );

  SELECT
    control.reconciled_epoch IS DISTINCT FROM control.summary_epoch,
    control.failure_count,
    control.invalidation,
    control.invalidated_at IS NOT NULL
      AND (control.reconciled_at IS NULL OR control.invalidated_at > control.reconciled_at)
  INTO v_epoch_mismatch, v_failure_count, v_invalidation, v_open_invalidation
  FROM historical_catalog_summary_control AS control;

  v_ok := coalesce(v_negative, 0) = 0
    AND coalesce(v_zero, 0) = 0
    AND coalesce(v_duplicate, 0) = 0
    AND coalesce(v_duplicate_labels, 0) = 0
    AND coalesce(v_bucket_members, 0) = 0
    AND coalesce(v_missing_membership, 0) = 0
    AND coalesce(v_extra_membership, 0) = 0
    AND coalesce(v_field, 0) = 0
    AND coalesce(v_label, 0) = 0
    AND coalesce(v_sum_n, 0) = coalesce(v_projection, 0)
    AND coalesce(v_sum_n, 0) = coalesce(v_accounted, 0)
    AND coalesce(v_blocking, 0) = 0;

  RETURN jsonb_build_object(
    'negativeBuckets', v_negative,
    'zeroBuckets', v_zero,
    'duplicateGrains', v_duplicate,
    'duplicateLabels', v_duplicate_labels,
    'bucketMemberMismatches', v_bucket_members,
    'projectionMissingMembership', v_missing_membership,
    'membershipWithoutProjection', v_extra_membership,
    'fieldMismatches', v_field,
    'rawLotMismatches', v_raw_lot,
    'rawNicheMismatches', v_raw_niche,
    'labelMismatches', v_label,
    'sumN', v_sum_n,
    'projectionRows', v_projection,
    'accountedMembers', v_accounted,
    'blockingCheckpoints', v_blocking,
    'epochMismatch', v_epoch_mismatch,
    'failureCount', v_failure_count,
    'invalidation', v_invalidation,
    'openInvalidation', v_open_invalidation,
    'ok', v_ok
  );
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_reconcile()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_epoch bigint;
  v_issues jsonb;
BEGIN
  v_epoch := historical_catalog_summary_lock_for_reconcile();
  v_issues := historical_catalog_summary_reconcile_issues();
  IF v_issues->>'ok' = 'true' THEN
    UPDATE historical_catalog_summary_control
    SET
      reconciled_epoch = summary_epoch,
      reconciled_at = clock_timestamp()
    WHERE singleton
      AND summary_epoch = v_epoch;
  ELSE
    PERFORM historical_catalog_summary_mark_unready('reconcile_failed', true);
  END IF;
  RETURN v_issues || jsonb_build_object('recordedEpoch', v_epoch, 'authorized', false);
END;
$fn$;

-- Not called by triggers or application code. A partial backfill, a blocking
-- checkpoint, or a field mismatch leaves summary_ready false.
CREATE FUNCTION historical_catalog_summary_authorize()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_epoch bigint;
  v_issues jsonb;
  v_marked integer;
BEGIN
  v_epoch := historical_catalog_summary_lock_for_reconcile();
  v_issues := historical_catalog_summary_reconcile_issues();
  IF v_issues->>'ok' IS DISTINCT FROM 'true' THEN
    PERFORM historical_catalog_summary_mark_unready('authorize_rejected', true);
    RETURN v_issues || jsonb_build_object('authorized', false, 'reason', 'reconcile');
  END IF;

  UPDATE historical_catalog_summary_control
  SET
    summary_ready = true,
    reconciled_epoch = summary_epoch,
    reconciled_at = clock_timestamp(),
    note = 'authorized by an explicit maintenance call'
  WHERE singleton
    AND summary_epoch = v_epoch
    AND summary_ready = false;
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  IF v_marked = 0 AND NOT EXISTS (
    SELECT 1
    FROM historical_catalog_summary_control
    WHERE summary_ready
      AND summary_epoch = v_epoch
      AND reconciled_epoch = summary_epoch
  ) THEN
    RAISE EXCEPTION 'summary authorize lost the control epoch';
  END IF;
  RETURN v_issues || jsonb_build_object('authorized', true, 'epoch', v_epoch);
END;
$fn$;

CREATE FUNCTION historical_catalog_summary_chunk_bounds()
RETURNS TABLE (range_after text, range_until text, item_count integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $fn$
  WITH ids AS (
    SELECT item_id FROM historical_catalog_projection
    UNION
    SELECT item_id FROM historical_catalog_summary_membership
  ),
  ordered AS (
    SELECT item_id, row_number() OVER (ORDER BY item_id) AS rn
    FROM ids
  ),
  grouped AS (
    SELECT
      (rn - 1) / historical_catalog_summary_chunk_cap() AS chunk_no,
      max(item_id) AS until_id,
      count(*)::integer AS item_count
    FROM ordered
    GROUP BY 1
  )
  SELECT
    coalesce(lag(until_id) OVER (ORDER BY chunk_no), ''),
    until_id,
    item_count
  FROM grouped
  ORDER BY chunk_no
$fn$;
