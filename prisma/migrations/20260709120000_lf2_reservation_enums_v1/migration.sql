-- LF2 Phase 2 PR A (step 1): extend enums in a dedicated migration transaction.

ALTER TYPE "LeadAllocationStatus" ADD VALUE 'delivering';
ALTER TYPE "LeadAllocationStatus" ADD VALUE 'review_required';
ALTER TYPE "DeliveryInstructionStatus" ADD VALUE 'executing';

CREATE TYPE "DeliveryAttemptStatus" AS ENUM (
  'planned',
  'claimed',
  'in_progress',
  'succeeded',
  'retryable_failure',
  'terminal_failure',
  'unknown_outcome',
  'skipped'
);
