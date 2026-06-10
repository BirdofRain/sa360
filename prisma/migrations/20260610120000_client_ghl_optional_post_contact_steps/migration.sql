-- Optional post-contact live canary step requirements (default: not required).
ALTER TABLE "ClientGhlDestination"
ADD COLUMN "ownerAssignmentRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "workflowStartRequired" BOOLEAN NOT NULL DEFAULT false;
