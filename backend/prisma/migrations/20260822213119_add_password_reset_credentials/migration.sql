-- CreateTable
CREATE TABLE "password_reset_credentials" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "message_id" UUID NOT NULL,
    "recovery_canonical_key" VARCHAR(254) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_credentials_user_id_key" ON "password_reset_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_credentials_token_hash_key" ON "password_reset_credentials"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_credentials_message_id_key" ON "password_reset_credentials"("message_id");

-- CreateIndex
CREATE INDEX "password_reset_credentials_expires_at_idx" ON "password_reset_credentials"("expires_at");

-- AddForeignKey
ALTER TABLE "password_reset_credentials" ADD CONSTRAINT "password_reset_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
