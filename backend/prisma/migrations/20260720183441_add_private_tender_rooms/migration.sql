-- CreateTable
CREATE TABLE "tender_rooms" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "host_id" UUID NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "tender_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_room_members" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_room_members_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tender_rooms_tender_id_key" ON "tender_rooms"("tender_id");

-- CreateIndex
CREATE INDEX "tender_rooms_status_idx" ON "tender_rooms"("status");

-- CreateIndex
CREATE INDEX "tender_room_members_user_id_idx" ON "tender_room_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_room_members_room_id_seat_key" ON "tender_room_members"("room_id", "seat");

-- AddForeignKey
ALTER TABLE "tender_rooms" ADD CONSTRAINT "tender_rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_rooms" ADD CONSTRAINT "tender_rooms_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_room_members" ADD CONSTRAINT "tender_room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "tender_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_room_members" ADD CONSTRAINT "tender_room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
