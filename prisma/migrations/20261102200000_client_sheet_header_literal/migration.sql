-- Allow a blank Google header to be stored as an empty string.
-- A previous writer stored that blank as U+200B so the older
-- client_onboarding_v2_string_array_ok check (length 1–200) would pass.
-- This migration lets headerSnapshot keep length 0 and rewrites those
-- sentinel cells back to "". Column order is preserved.
-- A header that is only U+200B and was stored by that writer cannot be
-- distinguished from a blank. Later literal U+200B headers are left alone.

CREATE FUNCTION client_onboarding_v2_header_snapshot_ok(value jsonb) RETURNS boolean
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

UPDATE "ClientSheetColumnMap" AS map
SET "headerSnapshot" = converted.header
FROM (
  SELECT
    id,
    (
      SELECT jsonb_agg(
        CASE
          WHEN item #>> '{}' = E'\u200b' THEN to_jsonb(''::text)
          ELSE item
        END
        ORDER BY ord
      )
      FROM jsonb_array_elements(m."headerSnapshot") WITH ORDINALITY AS cells(item, ord)
    ) AS header
  FROM "ClientSheetColumnMap" AS m
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(m."headerSnapshot") AS item
    WHERE item #>> '{}' = E'\u200b'
  )
) AS converted
WHERE map.id = converted.id;
