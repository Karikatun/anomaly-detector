-- CreateTable
CREATE TABLE "mail_outbox_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "message_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "recipient_domain" VARCHAR(253) NOT NULL,
    "template_kind" VARCHAR(40) NOT NULL,
    "template_payload" JSONB NOT NULL,
    "state" VARCHAR(24) NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" VARCHAR(64),
    "lease_expires_at" TIMESTAMP(3),
    "last_failure_code" VARCHAR(64),
    "provider_message_id" VARCHAR(320) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_delivery_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "outbox_id" UUID NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "failure_code" VARCHAR(64),
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_delivery_controls" (
    "id" VARCHAR(32) NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "deliveries_in_window" INTEGER NOT NULL DEFAULT 0,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "circuit_open_until" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_delivery_controls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_outbox_messages_message_id_key" ON "mail_outbox_messages"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_outbox_messages_provider_message_id_key" ON "mail_outbox_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "mail_outbox_messages_state_available_created_idx" ON "mail_outbox_messages"("state", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "mail_outbox_messages_domain_template_idx" ON "mail_outbox_messages"("recipient_domain", "template_kind");

-- CreateIndex
CREATE INDEX "mail_outbox_messages_completed_at_idx" ON "mail_outbox_messages"("completed_at");

-- CreateIndex
CREATE INDEX "mail_delivery_attempts_outcome_attempted_idx" ON "mail_delivery_attempts"("outcome", "attempted_at");

-- AddForeignKey
ALTER TABLE "mail_delivery_attempts" ADD CONSTRAINT "mail_delivery_attempts_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "mail_outbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
