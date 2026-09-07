-- CreateIndex
CREATE INDEX "tender_rooms_host_id_idx" ON "tender_rooms"("host_id");

-- CreateIndex
CREATE INDEX "tenders_state_jsonb_path_idx" ON "tenders" USING GIN ("state" jsonb_path_ops);
