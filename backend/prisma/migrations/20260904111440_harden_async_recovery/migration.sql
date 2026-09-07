-- DropIndex
DROP INDEX "mail_delivery_protection_alerts_delivery_idx";

-- AlterTable
ALTER TABLE "feedback_reports" ADD COLUMN     "submission_fingerprint" CHAR(64),
ADD COLUMN     "submission_id" UUID;

-- AlterTable
ALTER TABLE "mail_delivery_protection_alerts" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "last_failure_code" VARCHAR(64),
ADD COLUMN     "terminal_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletion_cleanup_completed_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_reports_submission_id_key" ON "feedback_reports"("submission_id");

-- CreateIndex
CREATE INDEX "mail_delivery_protection_alerts_claim_idx" ON "mail_delivery_protection_alerts"("delivered_at", "terminal_at", "available_at", "lease_expires_at", "occurred_at");
