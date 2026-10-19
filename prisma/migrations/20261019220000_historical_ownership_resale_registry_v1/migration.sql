-- Historical ownership and resale registry.
-- Additive empty tables, constraints, and read-only decision functions.
-- Does not alter inventory or fulfillment tables, insert rows, or stamp origin.
--
-- Rollback: drop this migration only before any registry row exists.
-- After a row exists, stop calling the decision functions and leave the tables.
--
-- Prisma cannot model the partial live-authorization index
-- HistoricalResaleAuthorization_one_live_scope_key, the append-only triggers,
-- or the decision functions. Do not drop them in a later generated migrate diff.
--
-- Decision functions (operator policy only; they do not write):
--   historical_campaign_ownership_decision(lot_key, import_request_key, july_label)
--   historical_resale_authorization_decision(lot_key, import_request_key, evaluated_at)
-- Scope keys are InventoryLot.lotKey or the census import-request id.
-- '(none)' and '(blank)' are missing scopes. Retired aliases do not cover a row.
-- Expired or revoked resale grants are not eligible. A proposal is not a grant.

CREATE TYPE "HistoricalRegistryScopeType" AS ENUM (
  'inventory_lot',
  'import_request'
);

CREATE TYPE "HistoricalCampaignAliasStatus" AS ENUM (
  'unassigned',
  'suggested',
  'confirmed',
  'conflicted',
  'retired'
);

CREATE TYPE "HistoricalCampaignAliasAction" AS ENUM (
  'recorded',
  'suggested',
  'confirmed',
  'reassigned',
  'conflicted',
  'retired'
);

CREATE TYPE "HistoricalCampaignAliasEvidenceType" AS ENUM (
  'july_label_record',
  'operator_case_file',
  'external_correspondence'
);

CREATE TYPE "HistoricalResaleAuthorizationStatus" AS ENUM (
  'proposed',
  'confirmed',
  'revoked'
);

CREATE TYPE "HistoricalResaleAuthorizationAction" AS ENUM (
  'proposed',
  'confirmed',
  'revoked'
);

CREATE TYPE "HistoricalResaleEvidenceType" AS ENUM (
  'purchase_agreement',
  'license',
  'acquisition_record'
);

CREATE FUNCTION historical_july_campaign_label_normalize(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT NULLIF(
    regexp_replace(btrim(COALESCE(p_label, '')), '[[:space:]]+', ' ', 'g'),
    ''
  )
$fn$;

CREATE FUNCTION historical_registry_scope_key_kind(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE
    WHEN p_key IS NULL THEN 'missing_scope'
    WHEN btrim(p_key) = '' THEN 'missing_scope'
    WHEN btrim(p_key) IN ('(none)', '(blank)') THEN 'missing_scope'
    ELSE 'present'
  END
$fn$;

CREATE FUNCTION historical_alias_evidence_reference_ok(p_type text, p_reference text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE p_type
    WHEN 'july_label_record' THEN COALESCE(p_reference, '') ~ '^july-label:[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    WHEN 'operator_case_file' THEN COALESCE(p_reference, '') ~ '^case-file:[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    WHEN 'external_correspondence' THEN COALESCE(p_reference, '') ~ '^correspondence:[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    ELSE false
  END
$fn$;

CREATE FUNCTION historical_resale_evidence_reference_ok(p_type text, p_reference text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $fn$
  SELECT CASE p_type
    WHEN 'purchase_agreement' THEN COALESCE(p_reference, '') ~ '^agreement:[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    WHEN 'license' THEN COALESCE(p_reference, '') ~ '^license:[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    WHEN 'acquisition_record' THEN COALESCE(p_reference, '') ~ '^acquisition:[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    ELSE false
  END
$fn$;

CREATE TABLE "HistoricalCampaignAlias" (
  "id" TEXT NOT NULL,
  "scopeType" "HistoricalRegistryScopeType" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "displayLabel" TEXT NOT NULL,
  "originClientAccountId" TEXT,
  "status" "HistoricalCampaignAliasStatus" NOT NULL DEFAULT 'unassigned',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HistoricalCampaignAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalCampaignAlias_originClientAccountId_fkey"
    FOREIGN KEY ("originClientAccountId") REFERENCES "ClientAccount"("clientAccountId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalCampaignAlias_label_chk" CHECK (
    char_length("normalizedLabel") BETWEEN 1 AND 300
    AND char_length("displayLabel") BETWEEN 1 AND 300
    AND "normalizedLabel" = historical_july_campaign_label_normalize("normalizedLabel")
    AND historical_july_campaign_label_normalize("displayLabel") = "normalizedLabel"
  ),
  CONSTRAINT "HistoricalCampaignAlias_scope_key_chk" CHECK (
    "scopeKey" = btrim("scopeKey")
    AND char_length("scopeKey") BETWEEN 1 AND 200
    AND "scopeKey" NOT IN ('(none)', '(blank)')
    AND "scopeKey" !~ '[[:space:]]'
  ),
  CONSTRAINT "HistoricalCampaignAlias_status_origin_chk" CHECK (
    ("status"::text = 'confirmed' AND "originClientAccountId" IS NOT NULL)
    OR ("status"::text IN ('unassigned', 'suggested', 'conflicted') AND "originClientAccountId" IS NULL)
    OR ("status"::text = 'retired')
  )
);

CREATE UNIQUE INDEX "HistoricalCampaignAlias_scope_label_key"
  ON "HistoricalCampaignAlias"("scopeType", "scopeKey", "normalizedLabel");

CREATE INDEX "HistoricalCampaignAlias_scope_idx"
  ON "HistoricalCampaignAlias"("scopeType", "scopeKey");

CREATE INDEX "HistoricalCampaignAlias_origin_idx"
  ON "HistoricalCampaignAlias"("originClientAccountId");

CREATE INDEX "HistoricalCampaignAlias_status_idx"
  ON "HistoricalCampaignAlias"("status");

CREATE TABLE "HistoricalCampaignAliasEvent" (
  "id" TEXT NOT NULL,
  "aliasId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "action" "HistoricalCampaignAliasAction" NOT NULL,
  "previousOriginClientAccountId" TEXT,
  "nextOriginClientAccountId" TEXT,
  "actor" TEXT NOT NULL,
  "note" TEXT,
  "evidenceReference" TEXT,
  "evidenceType" "HistoricalCampaignAliasEvidenceType",
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HistoricalCampaignAliasEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalCampaignAliasEvent_aliasId_fkey"
    FOREIGN KEY ("aliasId") REFERENCES "HistoricalCampaignAlias"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistAliasEvent_prev_origin_fkey"
    FOREIGN KEY ("previousOriginClientAccountId") REFERENCES "ClientAccount"("clientAccountId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistAliasEvent_next_origin_fkey"
    FOREIGN KEY ("nextOriginClientAccountId") REFERENCES "ClientAccount"("clientAccountId")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalCampaignAliasEvent_actor_chk" CHECK (
    "actor" = btrim("actor")
    AND char_length("actor") BETWEEN 1 AND 200
  ),
  CONSTRAINT "HistoricalCampaignAliasEvent_request_chk" CHECK (
    "requestId" = btrim("requestId")
    AND char_length("requestId") BETWEEN 8 AND 200
    AND "requestId" !~ '[[:space:]]'
  ),
  CONSTRAINT "HistoricalCampaignAliasEvent_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "HistoricalCampaignAliasEvent_action_chk" CHECK (
    ("action"::text = 'recorded'
      AND "previousOriginClientAccountId" IS NULL
      AND "nextOriginClientAccountId" IS NULL
      AND "evidenceReference" IS NULL
      AND "evidenceType" IS NULL)
    OR ("action"::text = 'suggested'
      AND "previousOriginClientAccountId" IS NULL
      AND "nextOriginClientAccountId" IS NOT NULL)
    OR ("action"::text = 'confirmed'
      AND "previousOriginClientAccountId" IS NULL
      AND "nextOriginClientAccountId" IS NOT NULL)
    OR ("action"::text = 'reassigned'
      AND "previousOriginClientAccountId" IS NOT NULL
      AND "nextOriginClientAccountId" IS NOT NULL
      AND "previousOriginClientAccountId" <> "nextOriginClientAccountId")
    OR ("action"::text = 'conflicted'
      AND "nextOriginClientAccountId" IS NULL)
    OR ("action"::text = 'retired'
      AND ("nextOriginClientAccountId" IS NOT DISTINCT FROM "previousOriginClientAccountId"))
  ),
  CONSTRAINT "HistoricalCampaignAliasEvent_evidence_chk" CHECK (
    (
      ("evidenceReference" IS NULL AND "evidenceType" IS NULL)
      OR historical_alias_evidence_reference_ok("evidenceType"::text, "evidenceReference")
    )
    AND (
      "note" IS NULL
      OR (
        char_length(btrim("note")) BETWEEN 1 AND 2000
        AND "note" = btrim("note")
        AND ("evidenceReference" IS NULL OR btrim("note") <> "evidenceReference")
        AND position('%PDF' in "note") = 0
        AND "note" !~* 'data:application'
      )
    )
  )
);

CREATE UNIQUE INDEX "HistAliasEvent_alias_seq_key"
  ON "HistoricalCampaignAliasEvent"("aliasId", "sequence");

CREATE UNIQUE INDEX "HistAliasEvent_request_id_key"
  ON "HistoricalCampaignAliasEvent"("requestId");

CREATE INDEX "HistAliasEvent_prev_origin_idx"
  ON "HistoricalCampaignAliasEvent"("previousOriginClientAccountId");

CREATE INDEX "HistAliasEvent_next_origin_idx"
  ON "HistoricalCampaignAliasEvent"("nextOriginClientAccountId");

CREATE INDEX "HistAliasEvent_alias_created_idx"
  ON "HistoricalCampaignAliasEvent"("aliasId", "createdAt");

CREATE TABLE "HistoricalResaleAuthorization" (
  "id" TEXT NOT NULL,
  "scopeType" "HistoricalRegistryScopeType" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "status" "HistoricalResaleAuthorizationStatus" NOT NULL DEFAULT 'proposed',
  "evidenceReference" TEXT,
  "evidenceType" "HistoricalResaleEvidenceType",
  "verificationDetails" TEXT,
  "operatorNote" TEXT,
  "authorizedOperator" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "effectiveAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HistoricalResaleAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalResaleAuthorization_scope_key_chk" CHECK (
    "scopeKey" = btrim("scopeKey")
    AND char_length("scopeKey") BETWEEN 1 AND 200
    AND "scopeKey" NOT IN ('(none)', '(blank)')
    AND "scopeKey" !~ '[[:space:]]'
  ),
  CONSTRAINT "HistoricalResaleAuthorization_status_chk" CHECK (
    (
      "status"::text = 'proposed'
      AND "verifiedAt" IS NULL
      AND "authorizedOperator" IS NULL
      AND "effectiveAt" IS NULL
      AND "expiresAt" IS NULL
      AND "revokedAt" IS NULL
      AND "revocationReason" IS NULL
    )
    OR (
      "status"::text = 'confirmed'
      AND historical_resale_evidence_reference_ok("evidenceType"::text, "evidenceReference")
      AND "verificationDetails" IS NOT NULL
      AND char_length(btrim("verificationDetails")) BETWEEN 12 AND 2000
      AND "verificationDetails" = btrim("verificationDetails")
      AND "authorizedOperator" IS NOT NULL
      AND "authorizedOperator" = btrim("authorizedOperator")
      AND char_length("authorizedOperator") BETWEEN 1 AND 200
      AND "verifiedAt" IS NOT NULL
      AND "effectiveAt" IS NOT NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > "effectiveAt")
      AND "revokedAt" IS NULL
      AND "revocationReason" IS NULL
      AND ("operatorNote" IS NULL OR btrim("operatorNote") <> "evidenceReference")
      AND ("operatorNote" IS NULL OR btrim("operatorNote") <> "verificationDetails")
    )
    OR (
      "status"::text = 'revoked'
      AND "revokedAt" IS NOT NULL
      AND "revocationReason" IS NOT NULL
      AND "revocationReason" = btrim("revocationReason")
      AND char_length("revocationReason") BETWEEN 3 AND 2000
      AND (
        "verifiedAt" IS NULL
        OR (
          historical_resale_evidence_reference_ok("evidenceType"::text, "evidenceReference")
          AND "verificationDetails" IS NOT NULL
          AND "authorizedOperator" IS NOT NULL
          AND "effectiveAt" IS NOT NULL
        )
      )
    )
  ),
  CONSTRAINT "HistoricalResaleAuthorization_evidence_pair_chk" CHECK (
    ("evidenceType" IS NULL AND "evidenceReference" IS NULL)
    OR historical_resale_evidence_reference_ok("evidenceType"::text, "evidenceReference")
  ),
  CONSTRAINT "HistoricalResaleAuthorization_verification_chk" CHECK (
    "verificationDetails" IS NULL
    OR (
      char_length(btrim("verificationDetails")) BETWEEN 12 AND 2000
      AND "verificationDetails" = btrim("verificationDetails")
      AND "verificationDetails" !~* 'data:application'
      AND position('%PDF' in "verificationDetails") = 0
    )
  ),
  CONSTRAINT "HistoricalResaleAuthorization_operator_note_chk" CHECK (
    "operatorNote" IS NULL
    OR (
      char_length(btrim("operatorNote")) BETWEEN 1 AND 2000
      AND "operatorNote" = btrim("operatorNote")
      AND "operatorNote" !~* 'data:application'
      AND position('%PDF' in "operatorNote") = 0
      AND ("evidenceReference" IS NULL OR btrim("operatorNote") <> "evidenceReference")
    )
  )
);

CREATE INDEX "HistoricalResaleAuthorization_scope_idx"
  ON "HistoricalResaleAuthorization"("scopeType", "scopeKey");

CREATE INDEX "HistoricalResaleAuthorization_status_exp_idx"
  ON "HistoricalResaleAuthorization"("status", "expiresAt");

-- One proposed or confirmed row per scope. Revoked rows stay as history.
-- A confirmed row past expiresAt still occupies this slot until it is revoked.
CREATE UNIQUE INDEX "HistoricalResaleAuthorization_one_live_scope_key"
  ON "HistoricalResaleAuthorization"("scopeType", "scopeKey")
  WHERE "status" IN ('proposed', 'confirmed');

CREATE TABLE "HistoricalResaleAuthorizationEvent" (
  "id" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "action" "HistoricalResaleAuthorizationAction" NOT NULL,
  "previousStatus" "HistoricalResaleAuthorizationStatus",
  "nextStatus" "HistoricalResaleAuthorizationStatus" NOT NULL,
  "actor" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "evidenceType" "HistoricalResaleEvidenceType",
  "verificationDetails" TEXT,
  "operatorNote" TEXT,
  "authorizedOperator" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "effectiveAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "HistoricalResaleAuthorizationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalResaleAuthorizationEvent_authorizationId_fkey"
    FOREIGN KEY ("authorizationId") REFERENCES "HistoricalResaleAuthorization"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "HistoricalResaleAuthorizationEvent_actor_chk" CHECK (
    "actor" = btrim("actor")
    AND char_length("actor") BETWEEN 1 AND 200
  ),
  CONSTRAINT "HistoricalResaleAuthorizationEvent_request_chk" CHECK (
    "requestId" = btrim("requestId")
    AND char_length("requestId") BETWEEN 8 AND 200
    AND "requestId" !~ '[[:space:]]'
  ),
  CONSTRAINT "HistoricalResaleAuthorizationEvent_sequence_chk" CHECK ("sequence" > 0),
  CONSTRAINT "HistoricalResaleAuthorizationEvent_action_chk" CHECK (
    "action"::text = "nextStatus"::text
    AND (
      ("action"::text = 'proposed'
        AND "previousStatus" IS NULL
        AND "authorizedOperator" IS NULL
        AND "verifiedAt" IS NULL
        AND "effectiveAt" IS NULL
        AND "expiresAt" IS NULL
        AND "revokedAt" IS NULL
        AND "revocationReason" IS NULL)
      OR ("action"::text = 'confirmed'
        AND "previousStatus"::text = 'proposed'
        AND historical_resale_evidence_reference_ok("evidenceType"::text, "evidenceReference")
        AND "verificationDetails" IS NOT NULL
        AND char_length(btrim("verificationDetails")) BETWEEN 12 AND 2000
        AND "authorizedOperator" = "actor"
        AND "verifiedAt" IS NOT NULL
        AND "effectiveAt" IS NOT NULL
        AND ("expiresAt" IS NULL OR "expiresAt" > "effectiveAt")
        AND "revokedAt" IS NULL
        AND "revocationReason" IS NULL
        AND ("operatorNote" IS NULL OR btrim("operatorNote") <> "evidenceReference"))
      OR ("action"::text = 'revoked'
        AND "previousStatus"::text IN ('proposed', 'confirmed')
        AND "revokedAt" IS NOT NULL
        AND "revocationReason" IS NOT NULL
        AND char_length(btrim("revocationReason")) BETWEEN 3 AND 2000)
    )
  ),
  CONSTRAINT "HistoricalResaleAuthorizationEvent_evidence_chk" CHECK (
    ("evidenceType" IS NULL AND "evidenceReference" IS NULL)
    OR historical_resale_evidence_reference_ok("evidenceType"::text, "evidenceReference")
  )
);

CREATE UNIQUE INDEX "HistoricalResaleAuthEvent_auth_seq_key"
  ON "HistoricalResaleAuthorizationEvent"("authorizationId", "sequence");

CREATE UNIQUE INDEX "HistoricalResaleAuthEvent_request_id_key"
  ON "HistoricalResaleAuthorizationEvent"("requestId");

CREATE INDEX "HistoricalResaleAuthEvent_created_idx"
  ON "HistoricalResaleAuthorizationEvent"("authorizationId", "createdAt");

CREATE FUNCTION historical_registry_assign_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  next_seq integer;
BEGIN
  IF TG_TABLE_NAME = 'HistoricalCampaignAliasEvent' THEN
    PERFORM 1 FROM "HistoricalCampaignAlias" WHERE id = NEW."aliasId" FOR UPDATE;
    SELECT COALESCE(MAX("sequence"), 0) + 1 INTO next_seq
    FROM "HistoricalCampaignAliasEvent"
    WHERE "aliasId" = NEW."aliasId";
  ELSE
    PERFORM 1 FROM "HistoricalResaleAuthorization" WHERE id = NEW."authorizationId" FOR UPDATE;
    SELECT COALESCE(MAX("sequence"), 0) + 1 INTO next_seq
    FROM "HistoricalResaleAuthorizationEvent"
    WHERE "authorizationId" = NEW."authorizationId";
  END IF;
  NEW."sequence" := next_seq;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION historical_registry_reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'historical registry events are append-only'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE FUNCTION historical_registry_reject_parent_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  RAISE EXCEPTION 'historical registry rows are retained'
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE FUNCTION historical_campaign_alias_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."scopeType" IS DISTINCT FROM OLD."scopeType"
     OR NEW."scopeKey" IS DISTINCT FROM OLD."scopeKey"
     OR NEW."normalizedLabel" IS DISTINCT FROM OLD."normalizedLabel"
     OR NEW."displayLabel" IS DISTINCT FROM OLD."displayLabel"
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'historical campaign alias identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status"::text = 'retired' AND NEW."status"::text IS DISTINCT FROM 'retired' THEN
    RAISE EXCEPTION 'retired historical campaign alias cannot be reactivated'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status"::text = 'confirmed' AND NEW."status"::text IN ('suggested', 'unassigned') THEN
    RAISE EXCEPTION 'confirmed historical ownership cannot be downgraded to a suggestion'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE FUNCTION historical_resale_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW."scopeType" IS DISTINCT FROM OLD."scopeType"
     OR NEW."scopeKey" IS DISTINCT FROM OLD."scopeKey"
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'historical resale authorization scope is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status"::text = 'revoked' THEN
    RAISE EXCEPTION 'revoked historical resale authorization is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status"::text = 'confirmed' AND NEW."status"::text = 'confirmed' THEN
    IF NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
       OR NEW."evidenceType" IS DISTINCT FROM OLD."evidenceType"
       OR NEW."verificationDetails" IS DISTINCT FROM OLD."verificationDetails"
       OR NEW."operatorNote" IS DISTINCT FROM OLD."operatorNote"
       OR NEW."authorizedOperator" IS DISTINCT FROM OLD."authorizedOperator"
       OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
       OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
       OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
       OR NEW."revocationReason" IS DISTINCT FROM OLD."revocationReason" THEN
      RAISE EXCEPTION 'confirmed historical resale authorization evidence is immutable'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF OLD."status"::text = 'confirmed' AND NEW."status"::text = 'revoked' THEN
    IF NEW."evidenceReference" IS DISTINCT FROM OLD."evidenceReference"
       OR NEW."evidenceType" IS DISTINCT FROM OLD."evidenceType"
       OR NEW."verificationDetails" IS DISTINCT FROM OLD."verificationDetails"
       OR NEW."operatorNote" IS DISTINCT FROM OLD."operatorNote"
       OR NEW."authorizedOperator" IS DISTINCT FROM OLD."authorizedOperator"
       OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
       OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
      RAISE EXCEPTION 'revocation cannot rewrite historical resale evidence'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF OLD."status"::text = 'confirmed' AND NEW."status"::text NOT IN ('confirmed', 'revoked') THEN
    RAISE EXCEPTION 'confirmed historical resale authorization cannot return to proposed'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE FUNCTION historical_campaign_alias_assert_history(p_alias_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  alias_status text;
  alias_origin text;
  ev record;
  ordinal integer := 0;
  prior_action text := NULL;
  prior_origin text := NULL;
  suggested_client text := NULL;
BEGIN
  SELECT "status"::text, "originClientAccountId"
    INTO alias_status, alias_origin
  FROM "HistoricalCampaignAlias"
  WHERE id = p_alias_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'historical campaign alias % is missing', p_alias_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  FOR ev IN
    SELECT *
    FROM "HistoricalCampaignAliasEvent"
    WHERE "aliasId" = p_alias_id
    ORDER BY "sequence" ASC, id ASC
  LOOP
    ordinal := ordinal + 1;
    IF ev."sequence" <> ordinal THEN
      RAISE EXCEPTION 'historical campaign alias % event sequence is not contiguous', p_alias_id
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF ordinal = 1 THEN
      IF ev.action::text NOT IN ('recorded', 'suggested', 'confirmed', 'conflicted') THEN
        RAISE EXCEPTION 'historical campaign alias % must open with recorded, suggested, confirmed, or conflicted', p_alias_id
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSE
      IF ev.action::text = 'recorded' THEN
        RAISE EXCEPTION 'recorded is only valid as the first historical alias event'
          USING ERRCODE = 'restrict_violation';
      ELSIF ev.action::text = 'suggested' AND prior_action NOT IN ('recorded', 'conflicted') THEN
        RAISE EXCEPTION 'a suggestion cannot follow %', prior_action
          USING ERRCODE = 'restrict_violation';
      ELSIF ev.action::text = 'confirmed' AND prior_action NOT IN ('recorded', 'suggested', 'conflicted') THEN
        RAISE EXCEPTION 'confirmation cannot follow %', prior_action
          USING ERRCODE = 'restrict_violation';
      ELSIF ev.action::text = 'reassigned' AND prior_action NOT IN ('confirmed', 'reassigned') THEN
        RAISE EXCEPTION 'reassignment cannot follow %', prior_action
          USING ERRCODE = 'restrict_violation';
      ELSIF ev.action::text = 'conflicted' AND prior_action = 'retired' THEN
        RAISE EXCEPTION 'a retired alias cannot be conflicted'
          USING ERRCODE = 'restrict_violation';
      ELSIF ev.action::text = 'retired' AND prior_action = 'retired' THEN
        RAISE EXCEPTION 'a retired alias cannot be retired again'
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;

    IF ev.action::text = 'confirmed' AND prior_action = 'suggested'
       AND ev."nextOriginClientAccountId" IS DISTINCT FROM suggested_client THEN
      RAISE EXCEPTION 'confirmation must use the suggested client or record a conflict'
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF ev.action::text = 'reassigned'
       AND ev."previousOriginClientAccountId" IS DISTINCT FROM prior_origin THEN
      RAISE EXCEPTION 'reassignment must preserve the prior origin client'
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF ev.action::text = 'conflicted'
       AND ev."previousOriginClientAccountId" IS DISTINCT FROM prior_origin THEN
      RAISE EXCEPTION 'conflict must preserve the prior origin client'
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF ev.action::text = 'retired'
       AND ev."previousOriginClientAccountId" IS DISTINCT FROM prior_origin THEN
      RAISE EXCEPTION 'retirement must preserve the prior origin client'
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF ev.action::text = 'suggested' THEN
      suggested_client := ev."nextOriginClientAccountId";
    ELSIF ev.action::text IN ('conflicted', 'recorded') THEN
      suggested_client := NULL;
    END IF;

    IF ev.action::text IN ('confirmed', 'reassigned') THEN
      prior_origin := ev."nextOriginClientAccountId";
    ELSIF ev.action::text = 'conflicted' THEN
      prior_origin := NULL;
    END IF;

    prior_action := ev.action::text;
  END LOOP;

  IF ordinal = 0 THEN
    RAISE EXCEPTION 'historical campaign alias % has no append-only event', p_alias_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF alias_status = 'confirmed' THEN
    IF prior_action NOT IN ('confirmed', 'reassigned')
       OR alias_origin IS NULL
       OR alias_origin IS DISTINCT FROM prior_origin THEN
      RAISE EXCEPTION 'confirmed historical alias % does not match its event history', p_alias_id
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF alias_status = 'suggested' THEN
    IF prior_action <> 'suggested' OR alias_origin IS NOT NULL THEN
      RAISE EXCEPTION 'suggested historical alias % is not ownership', p_alias_id
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF alias_status = 'unassigned' THEN
    IF prior_action <> 'recorded' OR alias_origin IS NOT NULL THEN
      RAISE EXCEPTION 'unassigned historical alias % must stay unassigned', p_alias_id
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF alias_status = 'conflicted' THEN
    IF prior_action <> 'conflicted' OR alias_origin IS NOT NULL THEN
      RAISE EXCEPTION 'conflicted historical alias % must not carry an origin', p_alias_id
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF alias_status = 'retired' THEN
    IF prior_action <> 'retired' THEN
      RAISE EXCEPTION 'retired historical alias % must end with a retired event', p_alias_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF alias_origin IS NOT NULL AND alias_origin IS DISTINCT FROM prior_origin THEN
      RAISE EXCEPTION 'retired historical alias % origin is not the prior confirmed client', p_alias_id
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported historical alias status %', alias_status
      USING ERRCODE = 'restrict_violation';
  END IF;
END;
$fn$;

CREATE FUNCTION historical_resale_authorization_assert_history(p_authorization_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  row_status text;
  row_evidence text;
  row_type text;
  row_details text;
  row_note text;
  row_operator text;
  row_verified timestamp;
  row_effective timestamp;
  row_expires timestamp;
  row_revoked timestamp;
  row_reason text;
  n integer;
  e1 record;
  e2 record;
  e3 record;
BEGIN
  SELECT
    "status"::text,
    "evidenceReference",
    "evidenceType"::text,
    "verificationDetails",
    "operatorNote",
    "authorizedOperator",
    "verifiedAt",
    "effectiveAt",
    "expiresAt",
    "revokedAt",
    "revocationReason"
  INTO
    row_status, row_evidence, row_type, row_details, row_note, row_operator,
    row_verified, row_effective, row_expires, row_revoked, row_reason
  FROM "HistoricalResaleAuthorization"
  WHERE id = p_authorization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'historical resale authorization % is missing', p_authorization_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT COUNT(*)::integer INTO n
  FROM "HistoricalResaleAuthorizationEvent"
  WHERE "authorizationId" = p_authorization_id;

  IF n = 0 THEN
    RAISE EXCEPTION 'historical resale authorization % has no append-only event', p_authorization_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF n > 3 THEN
    RAISE EXCEPTION 'historical resale authorization % has too many events', p_authorization_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO e1
  FROM "HistoricalResaleAuthorizationEvent"
  WHERE "authorizationId" = p_authorization_id AND "sequence" = 1;
  IF NOT FOUND
     OR e1.action::text <> 'proposed'
     OR e1."previousStatus" IS NOT NULL
     OR e1."nextStatus"::text <> 'proposed' THEN
    RAISE EXCEPTION 'historical resale authorization % must open with a proposal', p_authorization_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF n = 1 THEN
    IF row_status <> 'proposed'
       OR row_verified IS NOT NULL
       OR row_operator IS NOT NULL
       OR row_effective IS NOT NULL
       OR row_expires IS NOT NULL
       OR row_revoked IS NOT NULL
       OR row_reason IS NOT NULL THEN
      RAISE EXCEPTION 'proposed historical resale authorization % does not match its event', p_authorization_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN;
  END IF;

  SELECT * INTO e2
  FROM "HistoricalResaleAuthorizationEvent"
  WHERE "authorizationId" = p_authorization_id AND "sequence" = 2;

  IF n = 2 AND e2.action::text = 'confirmed' THEN
    IF row_status <> 'confirmed'
       OR e2."previousStatus"::text <> 'proposed'
       OR e2."authorizedOperator" IS DISTINCT FROM e2.actor
       OR row_operator IS DISTINCT FROM e2.actor
       OR row_evidence IS DISTINCT FROM e2."evidenceReference"
       OR row_type IS DISTINCT FROM e2."evidenceType"::text
       OR row_details IS DISTINCT FROM e2."verificationDetails"
       OR row_note IS DISTINCT FROM e2."operatorNote"
       OR row_verified IS DISTINCT FROM e2."verifiedAt"
       OR row_effective IS DISTINCT FROM e2."effectiveAt"
       OR row_expires IS DISTINCT FROM e2."expiresAt"
       OR row_revoked IS NOT NULL THEN
      RAISE EXCEPTION 'confirmed historical resale authorization % does not match its confirmation event', p_authorization_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN;
  END IF;

  IF n = 2 AND e2.action::text = 'revoked' THEN
    IF row_status <> 'revoked'
       OR e2."previousStatus"::text <> 'proposed'
       OR row_revoked IS DISTINCT FROM e2."revokedAt"
       OR row_reason IS DISTINCT FROM e2."revocationReason"
       OR row_verified IS NOT NULL
       OR row_operator IS NOT NULL THEN
      RAISE EXCEPTION 'withdrawn historical resale proposal % does not match its revocation event', p_authorization_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN;
  END IF;

  IF n = 3 THEN
    SELECT * INTO e3
    FROM "HistoricalResaleAuthorizationEvent"
    WHERE "authorizationId" = p_authorization_id AND "sequence" = 3;

    IF e2.action::text <> 'confirmed'
       OR e3.action::text <> 'revoked'
       OR e3."previousStatus"::text <> 'confirmed' THEN
      RAISE EXCEPTION 'historical resale authorization % revocation order is invalid', p_authorization_id
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF row_status <> 'revoked'
       OR row_operator IS DISTINCT FROM e2.actor
       OR row_evidence IS DISTINCT FROM e2."evidenceReference"
       OR row_type IS DISTINCT FROM e2."evidenceType"::text
       OR row_details IS DISTINCT FROM e2."verificationDetails"
       OR row_note IS DISTINCT FROM e2."operatorNote"
       OR row_verified IS DISTINCT FROM e2."verifiedAt"
       OR row_effective IS DISTINCT FROM e2."effectiveAt"
       OR row_expires IS DISTINCT FROM e2."expiresAt"
       OR row_revoked IS DISTINCT FROM e3."revokedAt"
       OR row_reason IS DISTINCT FROM e3."revocationReason"
       OR e3."evidenceReference" IS DISTINCT FROM e2."evidenceReference"
       OR e3."evidenceType" IS DISTINCT FROM e2."evidenceType"
       OR e3."verificationDetails" IS DISTINCT FROM e2."verificationDetails" THEN
      RAISE EXCEPTION 'revoked historical resale authorization % must preserve confirmation evidence', p_authorization_id
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN;
  END IF;

  RAISE EXCEPTION 'historical resale authorization % history is inconsistent', p_authorization_id
    USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE FUNCTION historical_campaign_alias_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM historical_campaign_alias_assert_history(NEW.id);
  RETURN NULL;
END;
$fn$;

CREATE FUNCTION historical_campaign_alias_event_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM historical_campaign_alias_assert_history(NEW."aliasId");
  RETURN NULL;
END;
$fn$;

CREATE FUNCTION historical_resale_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM historical_resale_authorization_assert_history(NEW.id);
  RETURN NULL;
END;
$fn$;

CREATE FUNCTION historical_resale_event_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  PERFORM historical_resale_authorization_assert_history(NEW."authorizationId");
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER "HistAliasEvent_sequence"
BEFORE INSERT ON "HistoricalCampaignAliasEvent"
FOR EACH ROW
EXECUTE FUNCTION historical_registry_assign_event_sequence();

CREATE TRIGGER "HistResaleEvent_sequence"
BEFORE INSERT ON "HistoricalResaleAuthorizationEvent"
FOR EACH ROW
EXECUTE FUNCTION historical_registry_assign_event_sequence();

CREATE TRIGGER "HistAliasEvent_append_only"
BEFORE UPDATE OR DELETE ON "HistoricalCampaignAliasEvent"
FOR EACH ROW
EXECUTE FUNCTION historical_registry_reject_event_mutation();

CREATE TRIGGER "HistAliasEvent_no_truncate"
BEFORE TRUNCATE ON "HistoricalCampaignAliasEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION historical_registry_reject_event_mutation();

CREATE TRIGGER "HistResaleEvent_append_only"
BEFORE UPDATE OR DELETE ON "HistoricalResaleAuthorizationEvent"
FOR EACH ROW
EXECUTE FUNCTION historical_registry_reject_event_mutation();

CREATE TRIGGER "HistResaleEvent_no_truncate"
BEFORE TRUNCATE ON "HistoricalResaleAuthorizationEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION historical_registry_reject_event_mutation();

CREATE TRIGGER "HistAlias_identity_guard"
BEFORE UPDATE ON "HistoricalCampaignAlias"
FOR EACH ROW
EXECUTE FUNCTION historical_campaign_alias_guard_identity();

CREATE TRIGGER "HistAlias_no_delete"
BEFORE DELETE ON "HistoricalCampaignAlias"
FOR EACH ROW
EXECUTE FUNCTION historical_registry_reject_parent_delete();

CREATE TRIGGER "HistAlias_no_truncate"
BEFORE TRUNCATE ON "HistoricalCampaignAlias"
FOR EACH STATEMENT
EXECUTE FUNCTION historical_registry_reject_parent_delete();

CREATE TRIGGER "HistResale_identity_guard"
BEFORE UPDATE ON "HistoricalResaleAuthorization"
FOR EACH ROW
EXECUTE FUNCTION historical_resale_guard_identity();

CREATE TRIGGER "HistResale_no_delete"
BEFORE DELETE ON "HistoricalResaleAuthorization"
FOR EACH ROW
EXECUTE FUNCTION historical_registry_reject_parent_delete();

CREATE TRIGGER "HistResale_no_truncate"
BEFORE TRUNCATE ON "HistoricalResaleAuthorization"
FOR EACH STATEMENT
EXECUTE FUNCTION historical_registry_reject_parent_delete();

CREATE CONSTRAINT TRIGGER "HistAlias_history_deferred"
AFTER INSERT OR UPDATE ON "HistoricalCampaignAlias"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION historical_campaign_alias_history_trigger();

CREATE CONSTRAINT TRIGGER "HistAliasEvent_history_deferred"
AFTER INSERT OR UPDATE ON "HistoricalCampaignAliasEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION historical_campaign_alias_event_history_trigger();

CREATE CONSTRAINT TRIGGER "HistResale_history_deferred"
AFTER INSERT OR UPDATE ON "HistoricalResaleAuthorization"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION historical_resale_history_trigger();

CREATE CONSTRAINT TRIGGER "HistResaleEvent_history_deferred"
AFTER INSERT OR UPDATE ON "HistoricalResaleAuthorizationEvent"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION historical_resale_event_history_trigger();

CREATE FUNCTION historical_campaign_ownership_decision(
  p_lot_key text,
  p_import_request_key text,
  p_july_label text
)
RETURNS TABLE (
  decision text,
  reason text,
  origin_client_account_id text,
  lot_status text,
  import_status text,
  lot_alias_id text,
  import_alias_id text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_label text;
  v_decision text := 'not_eligible';
  v_reason text := 'no_coverage';
  v_origin text := NULL;
  lot_origin text := NULL;
  import_origin text := NULL;
BEGIN
  v_label := historical_july_campaign_label_normalize(p_july_label);
  IF v_label IS NULL THEN
    RETURN QUERY SELECT
      'not_eligible'::text,
      'fail_closed_missing_label'::text,
      NULL::text,
      'missing_label'::text,
      'missing_label'::text,
      NULL::text,
      NULL::text;
    RETURN;
  END IF;

  IF historical_registry_scope_key_kind(p_lot_key) = 'missing_scope' THEN
    lot_status := 'missing_scope';
  ELSE
    SELECT id, "status"::text, "originClientAccountId"
      INTO lot_alias_id, lot_status, lot_origin
    FROM "HistoricalCampaignAlias"
    WHERE "scopeType" = 'inventory_lot'::"HistoricalRegistryScopeType"
      AND "scopeKey" = btrim(p_lot_key)
      AND "normalizedLabel" = v_label;
    IF NOT FOUND THEN
      lot_alias_id := NULL;
      lot_origin := NULL;
      lot_status := 'absent';
    END IF;
  END IF;

  IF historical_registry_scope_key_kind(p_import_request_key) = 'missing_scope' THEN
    import_status := 'missing_scope';
  ELSE
    SELECT id, "status"::text, "originClientAccountId"
      INTO import_alias_id, import_status, import_origin
    FROM "HistoricalCampaignAlias"
    WHERE "scopeType" = 'import_request'::"HistoricalRegistryScopeType"
      AND "scopeKey" = btrim(p_import_request_key)
      AND "normalizedLabel" = v_label;
    IF NOT FOUND THEN
      import_alias_id := NULL;
      import_origin := NULL;
      import_status := 'absent';
    END IF;
  END IF;

  IF lot_status = 'missing_scope' AND import_status = 'missing_scope' THEN
    v_reason := 'fail_closed_missing_scope';
  ELSIF lot_status = 'conflicted' OR import_status = 'conflicted' THEN
    v_reason := 'fail_closed_conflicted';
  ELSIF lot_status = 'confirmed' AND import_status = 'confirmed' THEN
    IF lot_origin IS NOT NULL AND lot_origin = import_origin THEN
      v_decision := 'eligible';
      v_reason := 'eligible_scopes_agree';
      v_origin := lot_origin;
    ELSE
      v_reason := 'fail_closed_conflicting_clients';
    END IF;
  ELSIF lot_status = 'confirmed' AND import_status IN ('absent', 'retired', 'missing_scope') THEN
    v_decision := 'eligible';
    v_reason := 'eligible_lot_only';
    v_origin := lot_origin;
  ELSIF import_status = 'confirmed' AND lot_status IN ('absent', 'retired', 'missing_scope') THEN
    v_decision := 'eligible';
    v_reason := 'eligible_import_request_only';
    v_origin := import_origin;
  ELSIF lot_status = 'confirmed' OR import_status = 'confirmed' THEN
    v_reason := 'fail_closed_ambiguous';
  ELSIF lot_status IN ('unassigned', 'suggested') AND import_status IN ('unassigned', 'suggested') THEN
    v_reason := 'fail_closed_ambiguous';
  ELSIF lot_status IN ('unassigned', 'suggested') OR import_status IN ('unassigned', 'suggested') THEN
    v_reason := 'suggestion_is_not_ownership';
  ELSE
    v_reason := 'no_coverage';
  END IF;

  IF v_decision = 'eligible' AND (v_origin IS NULL OR char_length(btrim(v_origin)) = 0) THEN
    v_decision := 'not_eligible';
    v_reason := 'fail_closed_incomplete_origin';
    v_origin := NULL;
  END IF;

  RETURN QUERY SELECT
    v_decision,
    v_reason,
    CASE WHEN v_decision = 'eligible' THEN v_origin ELSE NULL END,
    lot_status,
    import_status,
    lot_alias_id,
    import_alias_id;
END;
$fn$;

CREATE FUNCTION historical_resale_posture(
  p_scope_type text,
  p_scope_key text,
  p_evaluated_at timestamp
)
RETURNS TABLE (
  posture text,
  authorization_id text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
SET timezone = 'UTC'
AS $fn$
DECLARE
  live_id text;
  live_status text;
  live_reference text;
  live_type text;
  live_details text;
  live_operator text;
  live_verified timestamp;
  live_effective timestamp;
  live_expires timestamp;
  live_revoked timestamp;
  evidence_ok boolean;
  v_posture text;
BEGIN
  IF historical_registry_scope_key_kind(p_scope_key) = 'missing_scope' THEN
    RETURN QUERY SELECT 'missing_scope'::text, NULL::text;
    RETURN;
  END IF;

  SELECT
    id,
    "status"::text,
    "evidenceReference",
    "evidenceType"::text,
    "verificationDetails",
    "authorizedOperator",
    "verifiedAt",
    "effectiveAt",
    "expiresAt",
    "revokedAt"
  INTO
    live_id, live_status, live_reference, live_type, live_details, live_operator,
    live_verified, live_effective, live_expires, live_revoked
  FROM "HistoricalResaleAuthorization"
  WHERE "scopeType"::text = p_scope_type
    AND "scopeKey" = btrim(p_scope_key)
    AND "status"::text IN ('proposed', 'confirmed');

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM "HistoricalResaleAuthorization"
      WHERE "scopeType"::text = p_scope_type
        AND "scopeKey" = btrim(p_scope_key)
        AND "status"::text = 'revoked'
    ) THEN
      RETURN QUERY SELECT 'revoked_only'::text, NULL::text;
    ELSE
      RETURN QUERY SELECT 'absent'::text, NULL::text;
    END IF;
    RETURN;
  END IF;

  evidence_ok :=
    live_status = 'confirmed'
    AND live_revoked IS NULL
    AND historical_resale_evidence_reference_ok(live_type, live_reference)
    AND live_details IS NOT NULL
    AND char_length(btrim(live_details)) >= 12
    AND live_operator IS NOT NULL
    AND char_length(btrim(live_operator)) >= 1
    AND live_verified IS NOT NULL
    AND live_effective IS NOT NULL;

  IF live_status = 'proposed' THEN
    v_posture := 'proposed';
  ELSIF NOT evidence_ok THEN
    v_posture := 'incomplete';
  ELSIF live_effective > p_evaluated_at THEN
    v_posture := 'not_yet_effective';
  ELSIF live_expires IS NOT NULL AND live_expires <= p_evaluated_at THEN
    v_posture := 'expired';
  ELSE
    v_posture := 'granted';
  END IF;

  RETURN QUERY SELECT v_posture, live_id;
END;
$fn$;

CREATE FUNCTION historical_resale_authorization_decision(
  p_lot_key text,
  p_import_request_key text,
  p_evaluated_at timestamptz
)
RETURNS TABLE (
  decision text,
  reason text,
  lot_posture text,
  import_posture text,
  lot_authorization_id text,
  import_authorization_id text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_decision text := 'not_eligible';
  v_reason text := 'no_grant';
  lot_id text;
  import_id text;
  evaluated timestamp;
  open_posture text[] := ARRAY['absent', 'missing_scope', 'revoked_only'];
BEGIN
  IF p_evaluated_at IS NULL THEN
    RETURN QUERY SELECT
      'not_eligible'::text,
      'fail_closed_missing_evaluated_at'::text,
      'unevaluated'::text,
      'unevaluated'::text,
      NULL::text,
      NULL::text;
    RETURN;
  END IF;

  evaluated := p_evaluated_at AT TIME ZONE 'UTC';

  SELECT p.posture, p.authorization_id
    INTO lot_posture, lot_id
  FROM historical_resale_posture('inventory_lot', p_lot_key, evaluated) AS p;

  SELECT p.posture, p.authorization_id
    INTO import_posture, import_id
  FROM historical_resale_posture('import_request', p_import_request_key, evaluated) AS p;

  IF lot_posture = 'missing_scope' AND import_posture = 'missing_scope' THEN
    v_reason := 'fail_closed_missing_scope';
  ELSIF lot_posture = 'incomplete' OR import_posture = 'incomplete' THEN
    v_reason := 'fail_closed_incomplete_evidence';
  ELSIF lot_posture = 'granted' AND import_posture = 'granted' THEN
    v_decision := 'eligible';
    v_reason := 'eligible_scopes_agree';
  ELSIF lot_posture = 'granted' AND import_posture = ANY (open_posture || ARRAY['expired']) THEN
    v_decision := 'eligible';
    v_reason := 'eligible_lot_grant';
  ELSIF import_posture = 'granted' AND lot_posture = ANY (open_posture || ARRAY['expired']) THEN
    v_decision := 'eligible';
    v_reason := 'eligible_import_request_grant';
  ELSIF lot_posture = 'granted' OR import_posture = 'granted' THEN
    v_reason := 'fail_closed_ambiguous';
  ELSIF lot_posture = 'proposed' AND import_posture = ANY (open_posture) THEN
    v_reason := 'proposed_not_granted';
  ELSIF import_posture = 'proposed' AND lot_posture = ANY (open_posture) THEN
    v_reason := 'proposed_not_granted';
  ELSIF lot_posture = 'not_yet_effective' AND import_posture = ANY (open_posture) THEN
    v_reason := 'not_yet_effective';
  ELSIF import_posture = 'not_yet_effective' AND lot_posture = ANY (open_posture) THEN
    v_reason := 'not_yet_effective';
  ELSIF lot_posture IN ('proposed', 'not_yet_effective')
     OR import_posture IN ('proposed', 'not_yet_effective') THEN
    v_reason := 'fail_closed_ambiguous';
  ELSIF lot_posture = 'expired' OR import_posture = 'expired' THEN
    v_reason := 'expired';
  ELSIF lot_posture = 'revoked_only' OR import_posture = 'revoked_only' THEN
    v_reason := 'revoked_not_eligible';
  ELSE
    v_reason := 'no_grant';
  END IF;

  RETURN QUERY SELECT
    v_decision,
    v_reason,
    lot_posture,
    import_posture,
    CASE WHEN v_decision = 'eligible' AND lot_posture = 'granted' THEN lot_id ELSE NULL END,
    CASE WHEN v_decision = 'eligible' AND import_posture = 'granted' THEN import_id ELSE NULL END;
END;
$fn$;

COMMENT ON TABLE "HistoricalCampaignAlias" IS
  'July campaign label ownership for one inventory lot or import request. Confirmation is status confirmed. Suggestions keep originClientAccountId null.';

COMMENT ON TABLE "HistoricalResaleAuthorization" IS
  'Resale authorization for one scope. Independent of campaign alias ownership. Operator-only. Evidence columns are identifiers and short verification text, not documents.';

COMMENT ON COLUMN "HistoricalResaleAuthorization"."evidenceReference" IS
  'External agreement, license, or acquisition record id. Operator-only. Do not select from client portal routes.';

COMMENT ON COLUMN "HistoricalResaleAuthorization"."verificationDetails" IS
  'Short operator-only verification record. Do not select from client portal routes.';

COMMENT ON COLUMN "HistoricalResaleAuthorization"."operatorNote" IS
  'Operator text. A note does not establish resale rights.';

COMMENT ON FUNCTION historical_campaign_ownership_decision(text, text, text) IS
  'Read-only overlap decision for a July label. Returns an origin client id only when decision is eligible. Does not write inventory.';

COMMENT ON FUNCTION historical_resale_authorization_decision(text, text, timestamptz) IS
  'Read-only overlap decision for resale rights at evaluated_at. Expired, revoked, and proposed rows are not eligible. Does not write inventory.';
