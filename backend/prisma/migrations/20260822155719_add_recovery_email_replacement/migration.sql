-- CreateTable
CREATE TABLE "recovery_email_replacements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "requesting_session_id" UUID NOT NULL,
    "old_provider_value" VARCHAR(254) NOT NULL,
    "old_canonical_key" VARCHAR(254) NOT NULL,
    "old_code_hash" CHAR(64) NOT NULL,
    "old_message_id" UUID NOT NULL,
    "old_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "old_confirmed_at" TIMESTAMP(3),
    "old_expires_at" TIMESTAMP(3) NOT NULL,
    "new_provider_value" VARCHAR(254) NOT NULL,
    "new_canonical_key" VARCHAR(254) NOT NULL,
    "new_code_hash" CHAR(64) NOT NULL,
    "new_message_id" UUID NOT NULL,
    "new_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "new_confirmed_at" TIMESTAMP(3),
    "new_expires_at" TIMESTAMP(3) NOT NULL,
    "new_policy_version" INTEGER NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_email_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_replacements_user_id_key" ON "recovery_email_replacements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_replacements_session_id_key" ON "recovery_email_replacements"("requesting_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_replacements_old_message_id_key" ON "recovery_email_replacements"("old_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_replacements_new_message_id_key" ON "recovery_email_replacements"("new_message_id");

-- CreateIndex
CREATE INDEX "recovery_email_replacements_old_expires_at_idx" ON "recovery_email_replacements"("old_expires_at");

-- CreateIndex
CREATE INDEX "recovery_email_replacements_new_expires_at_idx" ON "recovery_email_replacements"("new_expires_at");

-- CreateIndex
CREATE INDEX "recovery_email_replacements_new_canonical_key_idx" ON "recovery_email_replacements"("new_canonical_key");

-- AddForeignKey
ALTER TABLE "recovery_email_replacements" ADD CONSTRAINT "recovery_email_replacements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_email_replacements" ADD CONSTRAINT "recovery_email_replacements_session_id_fkey" FOREIGN KEY ("requesting_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
