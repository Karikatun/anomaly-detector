-- CreateTable
CREATE TABLE "tenders" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_commands" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tender_id" UUID NOT NULL,
    "command_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_audit_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tender_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "command_id" TEXT,
    "actor_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenders_due_at_idx" ON "tenders"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tender_commands_tender_id_command_id_key" ON "tender_commands"("tender_id", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "tender_audit_events_tender_id_sequence_key" ON "tender_audit_events"("tender_id", "sequence");

-- AddForeignKey
ALTER TABLE "tender_commands" ADD CONSTRAINT "tender_commands_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_audit_events" ADD CONSTRAINT "tender_audit_events_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
