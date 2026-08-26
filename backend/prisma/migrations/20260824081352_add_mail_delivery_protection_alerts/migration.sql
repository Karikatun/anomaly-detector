-- CreateTable
CREATE TABLE "mail_delivery_protection_alerts" (
    "reason" VARCHAR(40) NOT NULL,
    "transition_at" TIMESTAMP(3) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_delivery_protection_alerts_pkey" PRIMARY KEY ("reason","transition_at")
);

-- CreateIndex
CREATE INDEX "mail_delivery_protection_alerts_occurred_at_idx" ON "mail_delivery_protection_alerts"("occurred_at");
