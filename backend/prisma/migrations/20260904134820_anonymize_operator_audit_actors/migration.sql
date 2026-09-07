-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletion_audit_pseudonym" UUID;

-- CreateIndex
CREATE INDEX "feedback_audit_events_actor_id_id_idx" ON "feedback_audit_events"("actor_id", "id");

-- CreateIndex
CREATE INDEX "feedback_operator_commands_actor_id_id_idx" ON "feedback_operator_commands"("actor_id", "id");

-- CreateIndex
CREATE INDEX "mail_policy_audit_events_actor_id_id_idx" ON "mail_policy_audit_events"("actor_id", "id");

-- CreateIndex
CREATE INDEX "mail_policy_commands_actor_id_id_idx" ON "mail_policy_commands"("actor_id", "id");

-- CreateIndex
CREATE INDEX "mail_policy_versions_published_by_id_idx" ON "mail_policy_versions"("published_by", "id");
