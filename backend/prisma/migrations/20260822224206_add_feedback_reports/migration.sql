-- CreateTable
CREATE TABLE "feedback_reports" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_number" VARCHAR(13) NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'new',
    "version" INTEGER NOT NULL DEFAULT 1,
    "error_what_happened" TEXT,
    "error_reproduction_steps" TEXT,
    "error_expected_result" TEXT,
    "error_can_continue" BOOLEAN,
    "suggestion_desired_change" TEXT,
    "suggestion_problem_solved" TEXT,
    "reply_email" VARCHAR(254),
    "linked_user_id" UUID,
    "build_sha" CHAR(40),
    "route_template" VARCHAR(64) NOT NULL,
    "device_class" VARCHAR(16) NOT NULL,
    "browser_class" VARCHAR(16) NOT NULL,
    "error_id" VARCHAR(64),
    "rejection_reason" VARCHAR(500),
    "github_issue_number" INTEGER,
    "taken_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "transferred_at" TIMESTAMP(3),
    "contact_deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_operator_commands" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "report_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "receipt" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_operator_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_audit_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "report_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "from_version" INTEGER NOT NULL,
    "to_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_reports_public_number_key" ON "feedback_reports"("public_number");

-- CreateIndex
CREATE INDEX "feedback_reports_status_created_at_idx" ON "feedback_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "feedback_reports_category_created_at_idx" ON "feedback_reports"("category", "created_at");

-- CreateIndex
CREATE INDEX "feedback_reports_linked_user_id_idx" ON "feedback_reports"("linked_user_id");

-- CreateIndex
CREATE INDEX "feedback_reports_resolved_at_idx" ON "feedback_reports"("resolved_at");

-- CreateIndex
CREATE INDEX "feedback_reports_rejected_at_idx" ON "feedback_reports"("rejected_at");

-- CreateIndex
CREATE INDEX "feedback_reports_transferred_at_idx" ON "feedback_reports"("transferred_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_operator_commands_command_id_key" ON "feedback_operator_commands"("command_id");

-- CreateIndex
CREATE INDEX "feedback_operator_commands_report_id_created_at_idx" ON "feedback_operator_commands"("report_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_audit_events_command_id_key" ON "feedback_audit_events"("command_id");

-- CreateIndex
CREATE INDEX "feedback_audit_events_report_id_occurred_at_idx" ON "feedback_audit_events"("report_id", "occurred_at");

-- CreateIndex
CREATE INDEX "feedback_audit_events_occurred_at_idx" ON "feedback_audit_events"("occurred_at");

-- AddForeignKey
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_operator_commands" ADD CONSTRAINT "feedback_operator_commands_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "feedback_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_audit_events" ADD CONSTRAINT "feedback_audit_events_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "feedback_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
