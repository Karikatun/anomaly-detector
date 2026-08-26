-- OAuth-only accounts have no local password credential.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
UPDATE "users" SET "password_hash" = NULL WHERE "password_hash" = 'OAUTH_USER';

-- The provider value is deliberately separate from the provider-specific
-- canonical uniqueness key. Conflict and unavailable states retain no address.
ALTER TABLE "users"
ADD COLUMN "account_email_provider_value" VARCHAR(254),
ADD COLUMN "account_email_canonical_key" VARCHAR(254),
ADD COLUMN "account_email_state" VARCHAR(32) NOT NULL DEFAULT 'absent';

CREATE UNIQUE INDEX "users_account_email_canonical_key_key"
ON "users"("account_email_canonical_key");

ALTER TABLE "users"
ADD CONSTRAINT "users_account_email_state_check"
CHECK ("account_email_state" IN ('absent', 'yandex_managed', 'yandex_conflict', 'yandex_unavailable')),
ADD CONSTRAINT "users_account_email_pair_check"
CHECK (
  (
    "account_email_state" = 'yandex_managed'
    AND "account_email_provider_value" IS NOT NULL
    AND "account_email_canonical_key" IS NOT NULL
  )
  OR
  (
    "account_email_state" <> 'yandex_managed'
    AND "account_email_provider_value" IS NULL
    AND "account_email_canonical_key" IS NULL
  )
);
