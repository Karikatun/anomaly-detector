-- AlterTable
ALTER TABLE "mail_delivery_protection_alerts" ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "lease_expires_at" TIMESTAMP(3),
ADD COLUMN     "lease_owner" VARCHAR(64);

-- CreateIndex
CREATE INDEX "mail_delivery_protection_alerts_delivery_idx" ON "mail_delivery_protection_alerts"("delivered_at", "lease_expires_at", "occurred_at");
