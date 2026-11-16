-- Local reverse. Prisma does not run this file. Do not run it on a remote database.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS "ExternalWebhookDestinationConfigRequest";

COMMIT;
