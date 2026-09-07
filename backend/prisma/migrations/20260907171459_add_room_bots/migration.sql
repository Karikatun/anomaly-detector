-- AlterTable
ALTER TABLE "tender_rooms" ADD COLUMN     "allow_bots" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bots" JSONB NOT NULL DEFAULT '[]';
