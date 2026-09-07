-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletion_cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletion_cleanup_available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletion_cleanup_claim_owner" VARCHAR(64),
ADD COLUMN     "deletion_cleanup_last_failure_code" VARCHAR(64),
ADD COLUMN     "deletion_cleanup_lease_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_deletion_cleanup_claim_idx" ON "users"("deletion_cleanup_available_at", "anonymized_at", "id") WHERE ("anonymized_at" IS NOT NULL AND "deletion_cleanup_completed_at" IS NULL);
