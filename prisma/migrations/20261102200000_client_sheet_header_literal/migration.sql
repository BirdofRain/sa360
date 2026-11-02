-- Allow a blank Google header to be stored as "".
--
-- Master stores headerSnapshot from the worksheet read. The U+200B blank
-- sentinel existed only on unmerged PR #262, so production rows were not
-- written by it. This migration does not rewrite any cell. A header whose
-- text is U+200B stays U+200B. Empty strings were invalid under
-- client_onboarding_v2_string_array_ok (length 1–200).

CREATE OR REPLACE FUNCTION client_onboarding_v2_header_snapshot_ok(value jsonb) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) BETWEEN 1 AND 80
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS item
      WHERE jsonb_typeof(item) <> 'string'
        OR char_length(item #>> '{}') > 200
    );
$fn$;

ALTER TABLE "ClientSheetColumnMap" DROP CONSTRAINT "ClientSheetColumnMap_scope_chk";

ALTER TABLE "ClientSheetColumnMap"
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
    AND client_onboarding_v2_header_snapshot_ok("headerSnapshot")
    AND jsonb_typeof("assignments") = 'array'
  );
