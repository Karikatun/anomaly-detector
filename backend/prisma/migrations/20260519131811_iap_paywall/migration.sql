-- CreateEnum
CREATE TYPE "subscription_platform" AS ENUM ('ios');

-- CreateEnum
CREATE TYPE "subscription_state" AS ENUM ('inactive', 'pending', 'active', 'billing_grace_period', 'billing_retry', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "subscription_entitlements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "entitlement_key" TEXT NOT NULL DEFAULT 'premium',
    "platform" "subscription_platform",
    "state" "subscription_state" NOT NULL DEFAULT 'inactive',
    "product_id" TEXT,
    "original_transaction_id" TEXT,
    "transaction_id" TEXT,
    "web_order_line_item_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "will_auto_renew" BOOLEAN,
    "environment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_store_transactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "original_transaction_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "web_order_line_item_id" TEXT,
    "product_id" TEXT NOT NULL,
    "state" "subscription_state" NOT NULL,
    "environment" TEXT,
    "app_account_token" TEXT,
    "purchase_date" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "will_auto_renew" BOOLEAN,
    "signed_transaction_hash" TEXT NOT NULL,
    "signed_renewal_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_store_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_store_webhooks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "notification_uuid" TEXT,
    "signed_payload_hash" TEXT NOT NULL,
    "notification_type" TEXT,
    "subtype" TEXT,
    "environment" TEXT,
    "original_transaction_id" TEXT,
    "transaction_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_store_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_entitlements_user_id_key" ON "subscription_entitlements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_entitlements_original_transaction_id_key" ON "subscription_entitlements"("original_transaction_id");

-- CreateIndex
CREATE INDEX "subscription_entitlements_state_idx" ON "subscription_entitlements"("state");

-- CreateIndex
CREATE INDEX "subscription_entitlements_expires_at_idx" ON "subscription_entitlements"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_transactions_transaction_id_key" ON "app_store_transactions"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_transactions_signed_transaction_hash_key" ON "app_store_transactions"("signed_transaction_hash");

-- CreateIndex
CREATE INDEX "app_store_transactions_user_id_idx" ON "app_store_transactions"("user_id");

-- CreateIndex
CREATE INDEX "app_store_transactions_original_transaction_id_idx" ON "app_store_transactions"("original_transaction_id");

-- CreateIndex
CREATE INDEX "app_store_transactions_state_idx" ON "app_store_transactions"("state");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_webhooks_notification_uuid_key" ON "app_store_webhooks"("notification_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "app_store_webhooks_signed_payload_hash_key" ON "app_store_webhooks"("signed_payload_hash");

-- CreateIndex
CREATE INDEX "app_store_webhooks_original_transaction_id_idx" ON "app_store_webhooks"("original_transaction_id");

-- CreateIndex
CREATE INDEX "app_store_webhooks_processed_at_idx" ON "app_store_webhooks"("processed_at");

-- AddForeignKey
ALTER TABLE "subscription_entitlements" ADD CONSTRAINT "subscription_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_store_transactions" ADD CONSTRAINT "app_store_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
