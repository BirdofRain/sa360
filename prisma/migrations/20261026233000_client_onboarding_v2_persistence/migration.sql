-- Client Onboarding v2 persistence.
-- Additive tables only. No backfill. No changes to existing tables.
-- Does not store OAuth tokens, webhook secrets, or GHL credentials.
-- Does not create leads, billing rows, inventory rows, or delivery jobs.
-- Does not enable Sheets or GHL delivery and does not move a cutoff.
-- Reconcile evidence cannot authorize another send. An uncertain outcome
-- cannot be updated into a retry. appendStartedAt on a test attempt is
-- evidence on that attempt only.
-- Audit rows survive client deletion. historicalClientAccountId is immutable.
-- The exact v3 header below is COMPANY_SHEETS_V3_HEADER. The four-column
-- Canary header is not a valid ClientOnboardingTestWorksheet.

CREATE FUNCTION client_onboarding_v2_exact_v3_header() RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT '[
    "Date","Client Name","Phone","Email","State","Lead Type","Age","DOB",
    "Military Status","Branch of Service","Marital Status","Desired Coverage",
    "Primary Reason","Primary Concern","Beneficiary","Time to Call",
    "Disability Rating","Healthcare Profession","Rig Type","Company or Independent",
    "Homeowner","House Type","Notes","First Name","Last Name","Sex",
    "Provider Lead ID","Completion Minutes","Phone Verified","Email Verified",
    "TrustedForm Status","delivery_row_id","client_account_id",
    "source_lead_event_id","received_at"
  ]'::jsonb;
$fn$;

CREATE FUNCTION client_onboarding_v2_sha256_ok(value text) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT value IS NULL OR value ~ '^[0-9a-f]{64}$';
$fn$;

CREATE FUNCTION client_onboarding_v2_idempotency_key_ok(value text) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT value ~ '^onboarding-test:[^[:space:]:]+:(sheets|ghl-contact|ghl-workflow|ghl-webhook|synthetic-sheets-delegate|ghl-note:[1-9][0-9]{0,2})$'
    AND value !~ '^(lead|campaign|ghl-webhook|ghl-note):'
    AND char_length(value) <= 200;
$fn$;

CREATE FUNCTION client_onboarding_v2_destination_list_ok(value jsonb, allow_empty boolean) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 3
    AND (allow_empty OR jsonb_array_length(value) >= 1)
    AND (
      SELECT count(DISTINCT item) FROM jsonb_array_elements_text(value) AS item
    ) = jsonb_array_length(value)
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(value) AS item
      WHERE item NOT IN ('google_sheets', 'ghl_location_api', 'ghl_inbound_webhook')
    );
$fn$;

CREATE FUNCTION client_onboarding_v2_qa_evidence_ok(value jsonb) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT value IS NULL OR (
    jsonb_typeof(value) = 'object'
    AND (value - 'status' - 'discardedDuplicateCount' - 'fullQaCompletenessAsserted') = '{}'::jsonb
    AND value->>'status' IN ('complete', 'discarded_duplicates', 'not_recoverable')
    AND (
      (
        value->>'status' = 'complete'
        AND value->>'fullQaCompletenessAsserted' = 'true'
        AND COALESCE(value->>'discardedDuplicateCount', '0') ~ '^[0-9]+$'
        AND (value->>'discardedDuplicateCount')::integer = 0
      )
      OR (
        value->>'status' = 'discarded_duplicates'
        AND value->>'fullQaCompletenessAsserted' = 'false'
        AND COALESCE(value->>'discardedDuplicateCount', '') ~ '^[1-9][0-9]*$'
        AND (value->>'discardedDuplicateCount')::integer >= 1
      )
      OR (
        value->>'status' = 'not_recoverable'
        AND value->>'fullQaCompletenessAsserted' = 'false'
        AND (
          NOT (value ? 'discardedDuplicateCount')
          OR (
            COALESCE(value->>'discardedDuplicateCount', '') ~ '^[0-9]+$'
            AND (value->>'discardedDuplicateCount')::integer = 0
          )
        )
      )
    )
  );
$fn$;

CREATE FUNCTION client_onboarding_v2_string_array_ok(value jsonb, min_len integer, max_len integer) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) BETWEEN min_len AND max_len
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS item
      WHERE jsonb_typeof(item) <> 'string'
        OR char_length(item #>> '{}') NOT BETWEEN 1 AND 200
    );
$fn$;

CREATE FUNCTION client_onboarding_v2_idempotency_key_list_ok(value jsonb) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_typeof(value) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(value) AS item
      WHERE NOT client_onboarding_v2_idempotency_key_ok(item)
    );
$fn$;

CREATE FUNCTION client_onboarding_v2_json_has_disallowed_key(value jsonb) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  item jsonb;
  key text;
  scalar text;
BEGIN
  IF value IS NULL THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(value) = 'object' THEN
    FOR key IN SELECT jsonb_object_keys(value)
    LOOP
      IF lower(key) IN (
        'token', 'secret', 'password', 'authorization', 'apikey', 'api_key',
        'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
        'credential', 'credentials', 'endpointurl', 'endpoint_url',
        'webhookurl', 'webhook_url', 'rawpayload', 'rawpayloadjson',
        'answers', 'field_data', 'form', 'oauth', 'oauthtoken', 'id_token', 'idtoken', 'bearer'
      ) THEN
        RETURN true;
      END IF;
      IF client_onboarding_v2_json_has_disallowed_key(value -> key) THEN
        RETURN true;
      END IF;
    END LOOP;
    RETURN false;
  END IF;
  IF jsonb_typeof(value) = 'array' THEN
    FOR item IN SELECT jsonb_array_elements(value)
    LOOP
      IF client_onboarding_v2_json_has_disallowed_key(item) THEN
        RETURN true;
      END IF;
    END LOOP;
    RETURN false;
  END IF;
  IF jsonb_typeof(value) = 'string' THEN
    scalar := value #>> '{}';
    IF scalar ~* 'https?://' OR scalar ~* 'bearer ' THEN
      RETURN true;
    END IF;
  END IF;
  RETURN false;
END;
$fn$;

CREATE TABLE "ClientOnboardingDestinationProfile" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "ghlMode" TEXT NOT NULL DEFAULT 'unset',
    "notesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notesContractVersion" TEXT,
    "sheetsSelected" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingDestinationProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOnboardingVerifiedTestIdentity" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "email" TEXT,
    "phoneE164" TEXT,
    "evidenceJson" JSONB NOT NULL DEFAULT '{}',
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorLabel" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingVerifiedTestIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOnboardingTestWorksheet" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "worksheetTitle" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "header" JSONB NOT NULL,
    "headerSha256" TEXT NOT NULL,
    "destinationRevision" INTEGER NOT NULL,
    "controlBasis" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingTestWorksheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOnboardingTestRun" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceLeadEventId" TEXT,
    "destinations" JSONB NOT NULL,
    "isolationMode" TEXT,
    "sheetsContract" TEXT,
    "repeatOfTestRunId" TEXT,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "previewJson" JSONB,
    "warningCodes" JSONB NOT NULL DEFAULT '[]',
    "qaEvidenceJson" JSONB,
    "noteBodySha256" TEXT,
    "sheetRowSha256" TEXT,
    "resendAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "appendStartedAtCleared" BOOLEAN NOT NULL DEFAULT false,
    "locksCleared" BOOLEAN NOT NULL DEFAULT false,
    "providerWebhookCalled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingTestRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOnboardingTestAttempt" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "proves" JSONB NOT NULL DEFAULT '[]',
    "doesNotProve" JSONB NOT NULL DEFAULT '[]',
    "externalCallExecuted" BOOLEAN NOT NULL DEFAULT false,
    "downstreamExecuted" BOOLEAN NOT NULL DEFAULT false,
    "httpStatus" INTEGER,
    "uncertainReason" TEXT,
    "externalCallEvidenceJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "appendStartedAt" TIMESTAMP(3),
    "spreadsheetId" TEXT,
    "worksheetId" INTEGER,
    "worksheetTitle" TEXT,
    "schemaVersion" TEXT,
    "header" JSONB,
    "headerSha256" TEXT,
    "control" JSONB,
    "ownerClientAccountId" TEXT NOT NULL,
    "destinationRevision" INTEGER,
    "productionCampaignBind" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingTestAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOnboardingTestAttemptKey" (
    "idempotencyKey" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "callKind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOnboardingTestAttemptKey_pkey" PRIMARY KEY ("idempotencyKey")
);

CREATE TABLE "ClientOnboardingV2AuditEvent" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "historicalClientAccountId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorLabel" TEXT,
    "auth" TEXT NOT NULL DEFAULT 'admin_api_key',
    "sourceLeadEventId" TEXT,
    "destinations" JSONB NOT NULL DEFAULT '[]',
    "isolationMode" TEXT,
    "idempotencyKeys" JSONB NOT NULL DEFAULT '[]',
    "noteBodySha256" TEXT,
    "sheetRowSha256" TEXT,
    "qaEvidenceJson" JSONB,
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOnboardingV2AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientOnboardingActivationIntent" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "expectedReceiptIds" JSONB NOT NULL DEFAULT '[]',
    "readinessEvidenceJson" JSONB NOT NULL DEFAULT '{}',
    "confirmationPhrase" TEXT NOT NULL,
    "actorLabel" TEXT,
    "activatesDelivery" BOOLEAN NOT NULL DEFAULT false,
    "deliverySwitchChanged" BOOLEAN NOT NULL DEFAULT false,
    "cutoffChanged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOnboardingActivationIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientSheetColumnMap" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "sourceScope" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "worksheetId" INTEGER NOT NULL,
    "mapVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "baseSchemaVersion" TEXT NOT NULL,
    "headerSnapshot" JSONB NOT NULL,
    "assignments" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSheetColumnMap_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ClientOnboardingDestinationProfile"
  ADD CONSTRAINT "ClientOnboardingDestinationProfile_mode_chk" CHECK (
    "ghlMode" IN ('unset', 'location_api', 'inbound_webhook', 'external_zapier')
  ),
  ADD CONSTRAINT "ClientOnboardingDestinationProfile_notes_chk" CHECK (
    ("notesEnabled" = false AND "notesContractVersion" IS NULL)
    OR (
      "notesEnabled" = true
      AND "ghlMode" = 'location_api'
      AND "notesContractVersion" = 'sa360_lead_note_v2'
    )
  ),
  ADD CONSTRAINT "ClientOnboardingDestinationProfile_revision_chk" CHECK ("revision" >= 1);

ALTER TABLE "ClientOnboardingVerifiedTestIdentity"
  ADD CONSTRAINT "ClientOnboardingVerifiedTestIdentity_contact_chk" CHECK (
    ("email" IS NOT NULL OR "phoneE164" IS NOT NULL)
    AND (
      "email" IS NULL
      OR (
        char_length("email") BETWEEN 3 AND 320
        AND position('@' IN "email") > 1
        AND "email" !~ '[[:space:]]'
      )
    )
    AND (
      "phoneE164" IS NULL
      OR "phoneE164" ~ '^\+[1-9][0-9]{7,14}$'
    )
  ),
  ADD CONSTRAINT "ClientOnboardingVerifiedTestIdentity_evidence_chk" CHECK (
    jsonb_typeof("evidenceJson") = 'object'
    AND NOT client_onboarding_v2_json_has_disallowed_key("evidenceJson")
    AND ("actorLabel" IS NULL OR char_length("actorLabel") <= 200)
  );

ALTER TABLE "ClientOnboardingTestWorksheet"
  ADD CONSTRAINT "ClientOnboardingTestWorksheet_exact_v3_chk" CHECK (
    "schemaVersion" = 'company_sheets_campaign_v3'
    AND "header" = client_onboarding_v2_exact_v3_header()
    AND jsonb_array_length("header") = 35
    AND "headerSha256" ~ '^[0-9a-f]{64}$'
    AND char_length("spreadsheetId") BETWEEN 1 AND 200
    AND "worksheetId" >= 0
    AND char_length(btrim("worksheetTitle")) BETWEEN 1 AND 200
    AND btrim("worksheetTitle") NOT IN ('Daily Stats', 'Weekly Stats')
    AND "destinationRevision" >= 1
  ),
  ADD CONSTRAINT "ClientOnboardingTestWorksheet_control_chk" CHECK (
    jsonb_typeof("controlBasis") = 'object'
    AND NOT client_onboarding_v2_json_has_disallowed_key("controlBasis")
    AND "controlBasis"->>'establishControl' IN (
      'company_created', 'drive_owner_verified', 'approved_shared_drive'
    )
    AND char_length(COALESCE("controlBasis"->>'checkedAt', '')) BETWEEN 10 AND 40
  );

ALTER TABLE "ClientOnboardingTestRun"
  ADD CONSTRAINT "ClientOnboardingTestRun_kind_chk" CHECK (
    "kind" IN ('preview', 'captured_event_replay', 'captured_event_delivery', 'synthetic_delivery')
  ),
  ADD CONSTRAINT "ClientOnboardingTestRun_status_chk" CHECK (
    "status" IN ('previewed', 'executing', 'succeeded', 'failed', 'uncertain', 'note_too_long')
  ),
  ADD CONSTRAINT "ClientOnboardingTestRun_destinations_chk" CHECK (
    client_onboarding_v2_destination_list_ok("destinations", false)
  ),
  ADD CONSTRAINT "ClientOnboardingTestRun_isolation_chk" CHECK (
    "isolationMode" IS NULL
    OR "isolationMode" IN ('verified_test_identity', 'isolated_destination')
  ),
  ADD CONSTRAINT "ClientOnboardingTestRun_sheets_contract_chk" CHECK (
    "sheetsContract" IS NULL
    OR "sheetsContract" IN ('exact_v3_test_worksheet', 'canary_v1_projection')
  ),
  ADD CONSTRAINT "ClientOnboardingTestRun_safety_chk" CHECK (
    "resendAuthorized" = false
    AND "appendStartedAtCleared" = false
    AND "locksCleared" = false
    AND "providerWebhookCalled" = false
  ),
  ADD CONSTRAINT "ClientOnboardingTestRun_qa_chk" CHECK (
    client_onboarding_v2_qa_evidence_ok("qaEvidenceJson")
  ),
  ADD CONSTRAINT "ClientOnboardingTestRun_snapshot_chk" CHECK (
    jsonb_typeof("requestSnapshot") = 'object'
    AND NOT client_onboarding_v2_json_has_disallowed_key("requestSnapshot")
    AND jsonb_typeof("warningCodes") = 'array'
    AND ("previewJson" IS NULL OR jsonb_typeof("previewJson") = 'object')
    AND client_onboarding_v2_sha256_ok("noteBodySha256")
    AND client_onboarding_v2_sha256_ok("sheetRowSha256")
  );

ALTER TABLE "ClientOnboardingTestAttempt"
  ADD CONSTRAINT "ClientOnboardingTestAttempt_status_chk" CHECK (
    "status" IN ('previewed', 'executing', 'succeeded', 'failed', 'uncertain', 'not_executed')
  ),
  ADD CONSTRAINT "ClientOnboardingTestAttempt_key_chk" CHECK (
    client_onboarding_v2_idempotency_key_ok("idempotencyKey")
    AND (
      (
        "destination" = 'google_sheets'
        AND ("idempotencyKey" ~ ':sheets$' OR "idempotencyKey" ~ ':synthetic-sheets-delegate$')
      )
      OR ("destination" = 'ghl_location_api' AND "idempotencyKey" ~ ':ghl-contact$')
      OR ("destination" = 'ghl_inbound_webhook' AND "idempotencyKey" ~ ':ghl-webhook$')
    )
  ),
  ADD CONSTRAINT "ClientOnboardingTestAttempt_downstream_chk" CHECK (
    "downstreamExecuted" = false
    AND ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599)
    AND ("uncertainReason" IS NULL OR char_length("uncertainReason") BETWEEN 1 AND 500)
    AND char_length("ownerClientAccountId") BETWEEN 1 AND 128
  ),
  ADD CONSTRAINT "ClientOnboardingTestAttempt_evidence_chk" CHECK (
    "externalCallEvidenceJson" IS NULL
    OR (
      jsonb_typeof("externalCallEvidenceJson") = 'object'
      AND NOT client_onboarding_v2_json_has_disallowed_key("externalCallEvidenceJson")
    )
  ),
  ADD CONSTRAINT "ClientOnboardingTestAttempt_sheets_chk" CHECK (
    (
      "destination" <> 'google_sheets'
      AND "spreadsheetId" IS NULL
      AND "worksheetId" IS NULL
      AND "worksheetTitle" IS NULL
      AND "schemaVersion" IS NULL
      AND "header" IS NULL
      AND "headerSha256" IS NULL
      AND "productionCampaignBind" = false
      AND "appendStartedAt" IS NULL
    )
    OR (
      "destination" = 'google_sheets'
      AND "idempotencyKey" ~ ':synthetic-sheets-delegate$'
      AND "schemaVersion" IS NULL
      AND "header" IS NULL
      AND "headerSha256" IS NULL
      AND "productionCampaignBind" = false
    )
    OR (
      "destination" = 'google_sheets'
      AND "idempotencyKey" ~ ':sheets$'
      AND "spreadsheetId" IS NOT NULL
      AND char_length("spreadsheetId") BETWEEN 1 AND 200
      AND "worksheetId" IS NOT NULL
      AND "worksheetId" >= 0
      AND "worksheetTitle" IS NOT NULL
      AND btrim("worksheetTitle") NOT IN ('Daily Stats', 'Weekly Stats')
      AND "destinationRevision" IS NOT NULL
      AND "destinationRevision" >= 1
      AND "control" IS NOT NULL
      AND jsonb_typeof("control") = 'object'
      AND NOT client_onboarding_v2_json_has_disallowed_key("control")
      AND "control"->>'establishControl' IN (
        'company_created', 'drive_owner_verified', 'approved_shared_drive'
      )
      AND "schemaVersion" = 'company_sheets_campaign_v3'
      AND "header" = client_onboarding_v2_exact_v3_header()
      AND "headerSha256" ~ '^[0-9a-f]{64}$'
    )
    OR (
      "destination" = 'google_sheets'
      AND "idempotencyKey" ~ ':sheets$'
      AND "externalCallExecuted" = false
      AND "appendStartedAt" IS NULL
      AND "status" IN ('previewed', 'not_executed', 'failed')
      AND "productionCampaignBind" = false
      AND "schemaVersion" = 'company_sheets_canary_v1'
      AND "header" = '["delivery_row_id","sample_formula","sample_plus","note"]'::jsonb
      AND "headerSha256" ~ '^[0-9a-f]{64}$'
      AND "spreadsheetId" IS NOT NULL
      AND "worksheetId" IS NOT NULL
      AND "worksheetTitle" IS NOT NULL
      AND btrim("worksheetTitle") NOT IN ('Daily Stats', 'Weekly Stats')
    )
  );

ALTER TABLE "ClientOnboardingTestAttemptKey"
  ADD CONSTRAINT "ClientOnboardingTestAttemptKey_kind_chk" CHECK (
    client_onboarding_v2_idempotency_key_ok("idempotencyKey")
    AND "callKind" IN (
      'sheets', 'ghl_contact', 'ghl_workflow', 'ghl_note', 'ghl_webhook', 'synthetic_sheets_delegate'
    )
  );

ALTER TABLE "ClientOnboardingV2AuditEvent"
  ADD CONSTRAINT "ClientOnboardingV2AuditEvent_auth_chk" CHECK ("auth" = 'admin_api_key'),
  ADD CONSTRAINT "ClientOnboardingV2AuditEvent_action_chk" CHECK (
    "action" ~ '^[a-z][a-z0-9_]{0,63}$'
    AND char_length("historicalClientAccountId") BETWEEN 1 AND 128
    AND char_length("clientAccountId") BETWEEN 1 AND 128
    AND ("actorLabel" IS NULL OR char_length("actorLabel") <= 200)
  ),
  ADD CONSTRAINT "ClientOnboardingV2AuditEvent_shape_chk" CHECK (
    client_onboarding_v2_destination_list_ok("destinations", true)
    AND ("isolationMode" IS NULL OR "isolationMode" IN ('verified_test_identity', 'isolated_destination'))
    AND client_onboarding_v2_idempotency_key_list_ok("idempotencyKeys")
    AND jsonb_typeof("metadataJson") = 'object'
    AND client_onboarding_v2_qa_evidence_ok("qaEvidenceJson")
    AND client_onboarding_v2_sha256_ok("noteBodySha256")
    AND client_onboarding_v2_sha256_ok("sheetRowSha256")
    AND NOT client_onboarding_v2_json_has_disallowed_key("metadataJson")
  ),
  ADD CONSTRAINT "ClientOnboardingV2AuditEvent_reconcile_chk" CHECK (
    (
      NOT ("metadataJson" ? 'resendAuthorized')
      OR "metadataJson"->>'resendAuthorized' = 'false'
    )
    AND (
      NOT ("metadataJson" ? 'appendStartedAtCleared')
      OR "metadataJson"->>'appendStartedAtCleared' = 'false'
    )
    AND (
      NOT ("metadataJson" ? 'locksCleared')
      OR "metadataJson"->>'locksCleared' = 'false'
    )
  );

ALTER TABLE "ClientOnboardingActivationIntent"
  ADD CONSTRAINT "ClientOnboardingActivationIntent_destination_chk" CHECK (
    "destination" IN ('google_sheets_campaign', 'ghl_location_api')
  ),
  ADD CONSTRAINT "ClientOnboardingActivationIntent_status_chk" CHECK (
    "status" IN ('ready_for_operator', 'blocked')
    AND "revision" >= 1
  ),
  ADD CONSTRAINT "ClientOnboardingActivationIntent_phrase_chk" CHECK (
    "confirmationPhrase" = 'ACTIVATE CLIENT ONBOARDING DESTINATION'
  ),
  ADD CONSTRAINT "ClientOnboardingActivationIntent_non_operational_chk" CHECK (
    "activatesDelivery" = false
    AND "deliverySwitchChanged" = false
    AND "cutoffChanged" = false
  ),
  ADD CONSTRAINT "ClientOnboardingActivationIntent_receipts_chk" CHECK (
    client_onboarding_v2_string_array_ok("expectedReceiptIds", 0, 50)
    AND jsonb_typeof("readinessEvidenceJson") = 'object'
    AND NOT client_onboarding_v2_json_has_disallowed_key("readinessEvidenceJson")
    AND ("actorLabel" IS NULL OR char_length("actorLabel") <= 200)
  );

ALTER TABLE "ClientSheetColumnMap"
  ADD CONSTRAINT "ClientSheetColumnMap_status_chk" CHECK (
    (
      "status" = 'draft'
      AND "publishedAt" IS NULL
      AND "retiredAt" IS NULL
    )
    OR (
      "status" = 'published'
      AND "publishedAt" IS NOT NULL
      AND "retiredAt" IS NULL
    )
    OR (
      "status" = 'retired'
      AND "retiredAt" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "ClientSheetColumnMap_scope_chk" CHECK (
    "mapVersion" >= 1
    AND "revision" >= 1
    AND "worksheetId" >= 0
    AND char_length("spreadsheetId") BETWEEN 1 AND 200
    AND char_length("baseSchemaVersion") BETWEEN 1 AND 80
    AND (
      "sourceScope" = 'shared'
      OR "sourceScope" ~ '^funnel:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    )
    AND client_onboarding_v2_string_array_ok("headerSnapshot", 1, 80)
    AND jsonb_typeof("assignments") = 'array'
  );

CREATE UNIQUE INDEX "ClientOnboardingDestinationProfile_clientAccountId_key" ON "ClientOnboardingDestinationProfile"("clientAccountId");

CREATE UNIQUE INDEX "ClientOnboardingVerifiedTestIdentity_requestId_key" ON "ClientOnboardingVerifiedTestIdentity"("requestId");

CREATE INDEX "ClientOnboardingVerifiedTestIdentity_clientAccountId_verifi_idx" ON "ClientOnboardingVerifiedTestIdentity"("clientAccountId", "verifiedAt");

CREATE UNIQUE INDEX "ClientOnboardingVerifiedTestIdentity_client_email_key"
  ON "ClientOnboardingVerifiedTestIdentity"("clientAccountId", lower("email"))
  WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "ClientOnboardingVerifiedTestIdentity_client_phone_key"
  ON "ClientOnboardingVerifiedTestIdentity"("clientAccountId", "phoneE164")
  WHERE "phoneE164" IS NOT NULL;

CREATE UNIQUE INDEX "ClientOnboardingTestWorksheet_clientAccountId_key" ON "ClientOnboardingTestWorksheet"("clientAccountId");

CREATE UNIQUE INDEX "ClientOnboardingTestWorksheet_sheet_key" ON "ClientOnboardingTestWorksheet"("spreadsheetId", "worksheetId");

CREATE UNIQUE INDEX "ClientOnboardingTestRun_requestId_key" ON "ClientOnboardingTestRun"("requestId");

CREATE INDEX "ClientOnboardingTestRun_client_created_idx" ON "ClientOnboardingTestRun"("clientAccountId", "createdAt");

CREATE INDEX "ClientOnboardingTestRun_client_event_status_idx" ON "ClientOnboardingTestRun"("clientAccountId", "sourceLeadEventId", "status");

CREATE INDEX "ClientOnboardingTestRun_status_created_idx" ON "ClientOnboardingTestRun"("status", "createdAt");

CREATE UNIQUE INDEX "ClientOnboardingTestAttempt_idempotencyKey_key" ON "ClientOnboardingTestAttempt"("idempotencyKey");

CREATE INDEX "ClientOnboardingTestAttempt_sheet_status_idx" ON "ClientOnboardingTestAttempt"("spreadsheetId", "worksheetId", "status");

CREATE UNIQUE INDEX "ClientOnboardingTestAttempt_run_destination_key" ON "ClientOnboardingTestAttempt"("testRunId", "destination");

CREATE INDEX "ClientOnboardingTestAttemptKey_attempt_idx" ON "ClientOnboardingTestAttemptKey"("attemptId");

CREATE UNIQUE INDEX "ClientOnboardingV2AuditEvent_requestId_key" ON "ClientOnboardingV2AuditEvent"("requestId");

CREATE INDEX "ClientOnboardingV2AuditEvent_client_created_idx" ON "ClientOnboardingV2AuditEvent"("clientAccountId", "createdAt");

CREATE INDEX "ClientOnboardingV2AuditEvent_historical_created_idx" ON "ClientOnboardingV2AuditEvent"("historicalClientAccountId", "createdAt");

CREATE INDEX "ClientOnboardingV2AuditEvent_event_created_idx" ON "ClientOnboardingV2AuditEvent"("sourceLeadEventId", "createdAt");

CREATE UNIQUE INDEX "ClientOnboardingActivationIntent_requestId_key" ON "ClientOnboardingActivationIntent"("requestId");

CREATE INDEX "ClientOnboardingActivationIntent_client_created_idx" ON "ClientOnboardingActivationIntent"("clientAccountId", "createdAt");

CREATE INDEX "ClientOnboardingActivationIntent_client_destination_idx" ON "ClientOnboardingActivationIntent"("clientAccountId", "destination", "revision");

CREATE INDEX "ClientSheetColumnMap_client_status_idx" ON "ClientSheetColumnMap"("clientAccountId", "status");

CREATE INDEX "ClientSheetColumnMap_client_sheet_idx" ON "ClientSheetColumnMap"("clientAccountId", "spreadsheetId", "worksheetId");

CREATE UNIQUE INDEX "ClientSheetColumnMap_version_key" ON "ClientSheetColumnMap"("clientAccountId", "sourceScope", "spreadsheetId", "worksheetId", "mapVersion");

CREATE UNIQUE INDEX "ClientSheetColumnMap_one_published_key"
  ON "ClientSheetColumnMap"("clientAccountId", "sourceScope", "spreadsheetId", "worksheetId")
  WHERE "status" = 'published';

ALTER TABLE "ClientOnboardingDestinationProfile" ADD CONSTRAINT "ClientOnboardingDestinationProfile_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOnboardingVerifiedTestIdentity" ADD CONSTRAINT "ClientOnboardingVerifiedTestIdentity_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOnboardingTestWorksheet" ADD CONSTRAINT "ClientOnboardingTestWorksheet_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOnboardingTestRun" ADD CONSTRAINT "ClientOnboardingTestRun_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOnboardingTestRun" ADD CONSTRAINT "ClientOnboardingTestRun_sourceLeadEventId_fkey" FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deferred so deleting a client can cascade every run in one transaction,
-- including a run that names another run as its prior attempt.
-- Do not recreate this constraint as NOT DEFERRABLE.
ALTER TABLE "ClientOnboardingTestRun" ADD CONSTRAINT "ClientOnboardingTestRun_repeatOfTestRunId_fkey" FOREIGN KEY ("repeatOfTestRunId") REFERENCES "ClientOnboardingTestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "ClientOnboardingTestAttempt" ADD CONSTRAINT "ClientOnboardingTestAttempt_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "ClientOnboardingTestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOnboardingTestAttemptKey" ADD CONSTRAINT "ClientOnboardingTestAttemptKey_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ClientOnboardingTestAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientOnboardingActivationIntent" ADD CONSTRAINT "ClientOnboardingActivationIntent_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientSheetColumnMap" ADD CONSTRAINT "ClientSheetColumnMap_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("clientAccountId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION client_onboarding_v2_run_client(run_id text) RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT "clientAccountId" FROM "ClientOnboardingTestRun" WHERE "id" = run_id;
$fn$;

CREATE FUNCTION client_onboarding_v2_test_attempt_guard() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  run_client text;
BEGIN
  run_client := client_onboarding_v2_run_client(NEW."testRunId");
  IF run_client IS NULL OR run_client IS DISTINCT FROM NEW."ownerClientAccountId" THEN
    RAISE EXCEPTION 'onboarding test attempt owner must equal the run client';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."testRunId" IS DISTINCT FROM OLD."testRunId"
     OR NEW."destination" IS DISTINCT FROM OLD."destination" THEN
    RAISE EXCEPTION 'onboarding test attempt identity is immutable';
  END IF;
  IF OLD."appendStartedAt" IS NOT NULL AND NEW."appendStartedAt" IS DISTINCT FROM OLD."appendStartedAt" THEN
    RAISE EXCEPTION 'appendStartedAt evidence cannot be cleared or rewritten';
  END IF;
  IF OLD."externalCallExecuted" IS TRUE AND NEW."externalCallExecuted" IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'external call evidence cannot be withdrawn';
  END IF;
  IF (OLD."externalCallExecuted" IS TRUE OR OLD."appendStartedAt" IS NOT NULL) AND (
    NEW."header" IS DISTINCT FROM OLD."header"
    OR NEW."headerSha256" IS DISTINCT FROM OLD."headerSha256"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."spreadsheetId" IS DISTINCT FROM OLD."spreadsheetId"
    OR NEW."worksheetId" IS DISTINCT FROM OLD."worksheetId"
    OR NEW."worksheetTitle" IS DISTINCT FROM OLD."worksheetTitle"
    OR NEW."control" IS DISTINCT FROM OLD."control"
    OR NEW."destinationRevision" IS DISTINCT FROM OLD."destinationRevision"
    OR NEW."productionCampaignBind" IS DISTINCT FROM OLD."productionCampaignBind"
  ) THEN
    RAISE EXCEPTION 'sheets destination snapshot is immutable after an external call';
  END IF;
  IF OLD.status = 'uncertain' AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW."proves" IS DISTINCT FROM OLD."proves"
    OR NEW."doesNotProve" IS DISTINCT FROM OLD."doesNotProve"
    OR NEW."externalCallEvidenceJson" IS DISTINCT FROM OLD."externalCallEvidenceJson"
    OR NEW."uncertainReason" IS DISTINCT FROM OLD."uncertainReason"
    OR NEW."httpStatus" IS DISTINCT FROM OLD."httpStatus"
    OR NEW."downstreamExecuted" IS DISTINCT FROM OLD."downstreamExecuted"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."finishedAt" IS DISTINCT FROM OLD."finishedAt"
    OR NEW."header" IS DISTINCT FROM OLD."header"
    OR NEW."appendStartedAt" IS DISTINCT FROM OLD."appendStartedAt"
  ) THEN
    RAISE EXCEPTION 'uncertain onboarding test attempt evidence is immutable';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'previewed', 'not_executed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'onboarding test attempt status is final';
  END IF;
  IF OLD.status = 'executing' AND NEW.status NOT IN (
    'executing', 'succeeded', 'failed', 'uncertain', 'not_executed'
  ) THEN
    RAISE EXCEPTION 'invalid onboarding test attempt transition';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "ClientOnboardingTestAttempt_guard"
BEFORE INSERT OR UPDATE ON "ClientOnboardingTestAttempt"
FOR EACH ROW
EXECUTE FUNCTION client_onboarding_v2_test_attempt_guard();

CREATE FUNCTION client_onboarding_v2_attempt_key_guard() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  attempt_destination text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'onboarding test idempotency keys are immutable';
  END IF;
  SELECT attempt."destination" INTO attempt_destination
  FROM "ClientOnboardingTestAttempt" AS attempt
  WHERE attempt."id" = NEW."attemptId";
  IF attempt_destination IS NULL THEN
    RAISE EXCEPTION 'onboarding test attempt key requires an attempt';
  END IF;
  IF attempt_destination = 'google_sheets' AND NEW."callKind" NOT IN ('sheets', 'synthetic_sheets_delegate') THEN
    RAISE EXCEPTION 'sheets attempt key does not match the destination';
  END IF;
  IF attempt_destination = 'ghl_location_api' AND NEW."callKind" NOT IN ('ghl_contact', 'ghl_workflow', 'ghl_note') THEN
    RAISE EXCEPTION 'ghl attempt key does not match the destination';
  END IF;
  IF attempt_destination = 'ghl_inbound_webhook' AND NEW."callKind" <> 'ghl_webhook' THEN
    RAISE EXCEPTION 'webhook attempt key does not match the destination';
  END IF;
  IF NEW."callKind" = 'sheets' AND NEW."idempotencyKey" !~ ':sheets$' THEN
    RAISE EXCEPTION 'sheets key suffix mismatch';
  END IF;
  IF NEW."callKind" = 'synthetic_sheets_delegate' AND NEW."idempotencyKey" !~ ':synthetic-sheets-delegate$' THEN
    RAISE EXCEPTION 'synthetic key suffix mismatch';
  END IF;
  IF NEW."callKind" = 'ghl_contact' AND NEW."idempotencyKey" !~ ':ghl-contact$' THEN
    RAISE EXCEPTION 'ghl contact key suffix mismatch';
  END IF;
  IF NEW."callKind" = 'ghl_workflow' AND NEW."idempotencyKey" !~ ':ghl-workflow$' THEN
    RAISE EXCEPTION 'ghl workflow key suffix mismatch';
  END IF;
  IF NEW."callKind" = 'ghl_note' AND NEW."idempotencyKey" !~ ':ghl-note:[1-9][0-9]{0,2}$' THEN
    RAISE EXCEPTION 'ghl note key suffix mismatch';
  END IF;
  IF NEW."callKind" = 'ghl_webhook' AND NEW."idempotencyKey" !~ ':ghl-webhook$' THEN
    RAISE EXCEPTION 'ghl webhook key suffix mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "ClientOnboardingTestAttemptKey_guard"
BEFORE INSERT OR UPDATE ON "ClientOnboardingTestAttemptKey"
FOR EACH ROW
EXECUTE FUNCTION client_onboarding_v2_attempt_key_guard();

CREATE FUNCTION client_onboarding_v2_attempt_key_present() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ClientOnboardingTestAttemptKey"
    WHERE "attemptId" = NEW."id"
      AND "idempotencyKey" = NEW."idempotencyKey"
  ) THEN
    RAISE EXCEPTION 'attempt idempotency key must be recorded';
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE CONSTRAINT TRIGGER "ClientOnboardingTestAttempt_key_present"
AFTER INSERT OR UPDATE OF "idempotencyKey" ON "ClientOnboardingTestAttempt"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION client_onboarding_v2_attempt_key_present();

CREATE FUNCTION client_onboarding_v2_test_run_guard() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW."requestId" IS DISTINCT FROM OLD."requestId"
     OR NEW."requestSnapshot" IS DISTINCT FROM OLD."requestSnapshot"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."sourceLeadEventId" IS DISTINCT FROM OLD."sourceLeadEventId"
     OR NEW."destinations" IS DISTINCT FROM OLD."destinations"
     OR NEW."isolationMode" IS DISTINCT FROM OLD."isolationMode"
     OR NEW."sheetsContract" IS DISTINCT FROM OLD."sheetsContract"
     OR NEW."repeatOfTestRunId" IS DISTINCT FROM OLD."repeatOfTestRunId"
     OR NEW."resendAuthorized" IS DISTINCT FROM false
     OR NEW."appendStartedAtCleared" IS DISTINCT FROM false
     OR NEW."locksCleared" IS DISTINCT FROM false
     OR NEW."providerWebhookCalled" IS DISTINCT FROM false
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'onboarding test run request is immutable';
  END IF;
  IF OLD."qaEvidenceJson" IS NOT NULL AND NEW."qaEvidenceJson" IS DISTINCT FROM OLD."qaEvidenceJson" THEN
    RAISE EXCEPTION 'qaEvidence is immutable once recorded';
  END IF;
  IF OLD."noteBodySha256" IS NOT NULL AND NEW."noteBodySha256" IS DISTINCT FROM OLD."noteBodySha256" THEN
    RAISE EXCEPTION 'note body hash is immutable once recorded';
  END IF;
  IF OLD."sheetRowSha256" IS NOT NULL AND NEW."sheetRowSha256" IS DISTINCT FROM OLD."sheetRowSha256" THEN
    RAISE EXCEPTION 'sheet row hash is immutable once recorded';
  END IF;
  IF OLD.status = 'uncertain' AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW."previewJson" IS DISTINCT FROM OLD."previewJson"
    OR NEW."warningCodes" IS DISTINCT FROM OLD."warningCodes"
    OR NEW."qaEvidenceJson" IS DISTINCT FROM OLD."qaEvidenceJson"
  ) THEN
    RAISE EXCEPTION 'uncertain onboarding test run is immutable';
  END IF;
  IF OLD.status IN ('previewed', 'succeeded', 'failed', 'note_too_long') AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW."previewJson" IS DISTINCT FROM OLD."previewJson"
    OR NEW."warningCodes" IS DISTINCT FROM OLD."warningCodes"
  ) THEN
    RAISE EXCEPTION 'onboarding test run status is final';
  END IF;
  IF OLD.status = 'executing' AND NEW.status NOT IN (
    'executing', 'succeeded', 'failed', 'uncertain', 'note_too_long'
  ) THEN
    RAISE EXCEPTION 'invalid onboarding test run transition';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "ClientOnboardingTestRun_guard"
BEFORE UPDATE ON "ClientOnboardingTestRun"
FOR EACH ROW
EXECUTE FUNCTION client_onboarding_v2_test_run_guard();

CREATE FUNCTION client_onboarding_v2_test_run_owner_sync() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW."clientAccountId" IS DISTINCT FROM OLD."clientAccountId" THEN
    UPDATE "ClientOnboardingTestAttempt"
    SET "ownerClientAccountId" = NEW."clientAccountId",
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "testRunId" = NEW."id"
      AND "ownerClientAccountId" = OLD."clientAccountId";
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER "ClientOnboardingTestRun_owner_sync"
AFTER UPDATE OF "clientAccountId" ON "ClientOnboardingTestRun"
FOR EACH ROW
EXECUTE FUNCTION client_onboarding_v2_test_run_owner_sync();

CREATE FUNCTION client_onboarding_v2_audit_guard() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ClientOnboardingV2AuditEvent is append-only';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."historicalClientAccountId" IS DISTINCT FROM OLD."historicalClientAccountId"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
     OR NEW."action" IS DISTINCT FROM OLD."action"
     OR NEW."actorLabel" IS DISTINCT FROM OLD."actorLabel"
     OR NEW."auth" IS DISTINCT FROM OLD."auth"
     OR NEW."sourceLeadEventId" IS DISTINCT FROM OLD."sourceLeadEventId"
     OR NEW."destinations" IS DISTINCT FROM OLD."destinations"
     OR NEW."isolationMode" IS DISTINCT FROM OLD."isolationMode"
     OR NEW."idempotencyKeys" IS DISTINCT FROM OLD."idempotencyKeys"
     OR NEW."noteBodySha256" IS DISTINCT FROM OLD."noteBodySha256"
     OR NEW."sheetRowSha256" IS DISTINCT FROM OLD."sheetRowSha256"
     OR NEW."qaEvidenceJson" IS DISTINCT FROM OLD."qaEvidenceJson"
     OR NEW."metadataJson" IS DISTINCT FROM OLD."metadataJson"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'ClientOnboardingV2AuditEvent evidence is immutable';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "ClientOnboardingV2AuditEvent_guard"
BEFORE UPDATE OR DELETE ON "ClientOnboardingV2AuditEvent"
FOR EACH ROW
EXECUTE FUNCTION client_onboarding_v2_audit_guard();

-- Privileges for the runtime role when it already exists.
-- Loopback databases can migrate before that role exists. This block then
-- grants nothing. It does not issue a password, create a role, or enable delivery.
-- Audit history is insert-only for the runtime role, plus the attribution
-- update used by a future rekey. There is no DELETE grant on the audit table.

DO $grant$
DECLARE
  server_addr inet := inet_server_addr();
  local_database boolean := server_addr IS NULL
    OR server_addr <<= inet '127.0.0.0/8'
    OR server_addr = inet '::1';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sa360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public."ClientOnboardingDestinationProfile",
      public."ClientOnboardingVerifiedTestIdentity",
      public."ClientOnboardingTestWorksheet",
      public."ClientOnboardingTestRun",
      public."ClientOnboardingTestAttempt",
      public."ClientSheetColumnMap",
      public."ClientOnboardingActivationIntent"
    TO sa360_app;
    GRANT SELECT, INSERT, DELETE ON TABLE public."ClientOnboardingTestAttemptKey" TO sa360_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE public."ClientOnboardingV2AuditEvent" TO sa360_app;
    RETURN;
  END IF;

  IF local_database THEN
    RAISE NOTICE 'client onboarding v2 grants skipped: sa360_app is absent on loopback';
    RETURN;
  END IF;

  RAISE EXCEPTION 'client onboarding v2 grants refused: sa360_app is absent';
END
$grant$;
