-- CreateTable
CREATE TABLE "recovery_email_challenges" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "provider_value" VARCHAR(254) NOT NULL,
    "canonical_key" VARCHAR(254) NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "message_id" UUID NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "cancellation_session_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "policy_version" INTEGER NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_email_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_email_bindings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "provider_value" VARCHAR(254) NOT NULL,
    "canonical_key" VARCHAR(254) NOT NULL,
    "cancellation_session_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "policy_version" INTEGER NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "activates_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_email_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_challenges_user_id_key" ON "recovery_email_challenges"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_challenges_message_id_key" ON "recovery_email_challenges"("message_id");

-- CreateIndex
CREATE INDEX "recovery_email_challenges_expires_at_idx" ON "recovery_email_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "recovery_email_challenges_canonical_key_idx" ON "recovery_email_challenges"("canonical_key");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_bindings_user_id_key" ON "recovery_email_bindings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_email_bindings_canonical_key_key" ON "recovery_email_bindings"("canonical_key");

-- CreateIndex
CREATE INDEX "recovery_email_bindings_activates_at_idx" ON "recovery_email_bindings"("activates_at");

-- AddForeignKey
ALTER TABLE "recovery_email_challenges" ADD CONSTRAINT "recovery_email_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_email_bindings" ADD CONSTRAINT "recovery_email_bindings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
