-- Delivery-time workflow requirement for one GHL live run.
--
-- Null means this attempt did not record the requirement. Existing rows stay
-- null. true and false are the value used to plan that run, including false.
-- This does not copy ClientGhlDestination and does not backfill.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE "GhlLiveDeliveryRun" ADD COLUMN "workflowStartRequired" BOOLEAN;

COMMIT;
