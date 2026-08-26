-- CreateTable
CREATE TABLE "recovery_code_sets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_code_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_code_reissues" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "requesting_session_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "message_id" UUID NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "recovery_canonical_key" VARCHAR(254) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_code_reissues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_code_email_replacements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "old_provider_value" VARCHAR(254) NOT NULL,
    "old_canonical_key" VARCHAR(254) NOT NULL,
    "new_provider_value" VARCHAR(254) NOT NULL,
    "new_canonical_key" VARCHAR(254) NOT NULL,
    "new_code_hash" CHAR(64) NOT NULL,
    "new_message_id" UUID NOT NULL,
    "new_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "new_policy_version" INTEGER NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "new_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_code_email_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_sets_user_id_key" ON "recovery_code_sets"("user_id");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_user_id_code_hash_key" ON "recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_reissues_user_id_key" ON "recovery_code_reissues"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_reissues_session_id_key" ON "recovery_code_reissues"("requesting_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_reissues_message_id_key" ON "recovery_code_reissues"("message_id");

-- CreateIndex
CREATE INDEX "recovery_code_reissues_expires_at_idx" ON "recovery_code_reissues"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_email_replacements_user_id_key" ON "recovery_code_email_replacements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_code_email_replacements_message_id_key" ON "recovery_code_email_replacements"("new_message_id");

-- CreateIndex
CREATE INDEX "recovery_code_email_replacements_new_canonical_key_idx" ON "recovery_code_email_replacements"("new_canonical_key");

-- CreateIndex
CREATE INDEX "recovery_code_email_replacements_new_expires_at_idx" ON "recovery_code_email_replacements"("new_expires_at");

-- AddForeignKey
ALTER TABLE "recovery_code_sets" ADD CONSTRAINT "recovery_code_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code_reissues" ADD CONSTRAINT "recovery_code_reissues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code_reissues" ADD CONSTRAINT "recovery_code_reissues_session_id_fkey" FOREIGN KEY ("requesting_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_code_email_replacements" ADD CONSTRAINT "recovery_code_email_replacements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
