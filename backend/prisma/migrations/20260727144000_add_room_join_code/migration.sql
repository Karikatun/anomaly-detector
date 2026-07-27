-- AlterTable
ALTER TABLE "tender_rooms" ADD COLUMN     "join_code" VARCHAR(10);

-- CreateIndex
CREATE UNIQUE INDEX "tender_rooms_join_code_key" ON "tender_rooms"("join_code");
