-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "abandonment_due_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tenders_abandonment_due_at_idx" ON "tenders"("abandonment_due_at");
