-- Additive LeadOrder payment confirmation dimension (customer journey PR A).
-- Independent of LeadOrder.status, approvedAt, prices, and fulfillment counters.
--
-- Existing rows receive pending_confirmation. That does not block already
-- ready/active/completed orders: guards apply only to new approve/activate
-- writes, not to reading or remaining in a current status. Do not infer
-- confirmed or not_required from approvedAt, zero prices, or order status.

CREATE TYPE "LeadOrderPaymentConfirmationStatus" AS ENUM (
  'pending_confirmation',
  'confirmed',
  'not_required'
);

ALTER TABLE "LeadOrder"
  ADD COLUMN "paymentConfirmationStatus" "LeadOrderPaymentConfirmationStatus" NOT NULL DEFAULT 'pending_confirmation',
  ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "paymentConfirmedBy" TEXT;
