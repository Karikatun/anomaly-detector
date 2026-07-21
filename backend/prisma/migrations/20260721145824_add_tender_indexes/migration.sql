-- CreateIndex
CREATE INDEX "tender_audit_events_tender_id_kind_idx" ON "tender_audit_events"("tender_id", "kind");

-- CreateIndex
CREATE INDEX "tenders_phase_idx" ON "tenders"("phase");
