-- The RKN-derived pre-release policy never reached production. Reset that local
-- state instead of carrying an unsafe compatibility path into the reviewed catalog.
DELETE FROM "mail_policy_commands";
DELETE FROM "mail_policy_audit_events";
DELETE FROM "mail_policy_entries";
DELETE FROM "mail_policy_versions";

-- AlterTable
ALTER TABLE "mail_policy_entries"
DROP CONSTRAINT "mail_policy_entries_source_candidate_id_fkey",
DROP COLUMN "source_candidate_id",
ADD COLUMN "provider_id" VARCHAR(64) NOT NULL;

-- DropTable
DROP TABLE "mail_registry_candidates";
DROP TABLE "mail_registry_imports";

-- AlterTable
ALTER TABLE "recovery_email_bindings" ADD COLUMN     "provider_id" VARCHAR(64);

-- Capture the provider selected by the worker once, so retained delivery
-- history never depends on a mutable or expired DNS assessment.
ALTER TABLE "mail_outbox_messages" ADD COLUMN "policy_provider_id" VARCHAR(64);

CREATE INDEX "mail_outbox_messages_policy_provider_template_idx"
ON "mail_outbox_messages"("policy_provider_id", "template_kind");

-- Exact public mailbox suffixes can be backfilled without DNS. Existing custom
-- domains remain nullable and are re-checked by the mail worker before delivery.
UPDATE "recovery_email_bindings"
SET "provider_id" = CASE lower(split_part("canonical_key", '@', 2))
    WHEN 'yandex.ru' THEN 'yandex'
    WHEN 'mail.ru' THEN 'vk_mail'
    WHEN 'inbox.ru' THEN 'vk_mail'
    WHEN 'bk.ru' THEN 'vk_mail'
    WHEN 'list.ru' THEN 'vk_mail'
    WHEN 'internet.ru' THEN 'vk_mail'
    WHEN 'rambler.ru' THEN 'rambler'
END
WHERE "provider_id" IS NULL
  AND lower(split_part("canonical_key", '@', 2)) IN (
    'yandex.ru',
    'mail.ru',
    'inbox.ru',
    'bk.ru',
    'list.ru',
    'internet.ru',
    'rambler.ru'
  );

-- AlterTable
ALTER TABLE "mail_policy_versions" ADD COLUMN     "catalog_version" INTEGER NOT NULL,
ADD COLUMN     "provider_catalog" JSONB NOT NULL;

-- CreateTable
CREATE TABLE "mail_domain_assessments" (
    "email_domain" VARCHAR(253) NOT NULL,
    "catalog_version" INTEGER NOT NULL,
    "provider_id" VARCHAR(64),
    "outcome" VARCHAR(16) NOT NULL,
    "failure_code" VARCHAR(64),
    "mx_fingerprint" CHAR(64),
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_domain_assessments_pkey" PRIMARY KEY ("email_domain")
);

-- CreateIndex
CREATE INDEX "mail_domain_assessments_expires_at_idx" ON "mail_domain_assessments"("expires_at");

-- CreateIndex
CREATE INDEX "mail_domain_assessments_provider_outcome_idx" ON "mail_domain_assessments"("provider_id", "outcome");
