-- AlterTable
ALTER TABLE "oauth_transactions" ADD COLUMN     "legal_accepted_at" TIMESTAMP(3),
ADD COLUMN     "privacy_consent_version" TEXT,
ADD COLUMN     "terms_version" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "privacy_consent_at" TIMESTAMP(3),
ADD COLUMN     "privacy_consent_version" TEXT,
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT;
