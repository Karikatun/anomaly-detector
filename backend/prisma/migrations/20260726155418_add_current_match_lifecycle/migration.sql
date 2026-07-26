-- CreateTable
CREATE TABLE "current_matches" (
    "user_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "current_matches_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "current_matches_room_id_idx" ON "current_matches"("room_id");

-- AddForeignKey
ALTER TABLE "current_matches" ADD CONSTRAINT "current_matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "current_matches" ADD CONSTRAINT "current_matches_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "tender_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
