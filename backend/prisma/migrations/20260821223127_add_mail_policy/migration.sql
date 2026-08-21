-- CreateTable
CREATE TABLE "mail_registry_imports" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_id" UUID NOT NULL,
    "source_date" VARCHAR(10),
    "source_url" TEXT,
    "checksum" CHAR(64),
    "outcome" VARCHAR(16) NOT NULL,
    "failure_code" VARCHAR(64),
    "added_domains" JSONB NOT NULL,
    "removed_domains" JSONB NOT NULL,
    "unchanged_count" INTEGER NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_registry_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_registry_candidates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "import_id" UUID NOT NULL,
    "registry_entry_id" VARCHAR(64) NOT NULL,
    "service_domain" VARCHAR(253) NOT NULL,
    "evidence" VARCHAR(64) NOT NULL,

    CONSTRAINT "mail_registry_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_policy_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version" INTEGER NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_policy_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" UUID NOT NULL,
    "source_candidate_id" UUID NOT NULL,
    "email_domain" VARCHAR(253) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "local_part_case_insensitive" BOOLEAN NOT NULL,
    "strip_plus_tag" BOOLEAN NOT NULL,
    "ignore_dots" BOOLEAN NOT NULL,
    "reason" VARCHAR(500),

    CONSTRAINT "mail_policy_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_policy_commands" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "command_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "receipt" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_policy_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_policy_audit_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_policy_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_registry_imports_outcome_finished_at_idx" ON "mail_registry_imports"("outcome", "finished_at");

-- CreateIndex
CREATE INDEX "mail_registry_candidates_import_domain_idx" ON "mail_registry_candidates"("import_id", "service_domain");

-- CreateIndex
CREATE UNIQUE INDEX "mail_registry_candidates_import_entry_domain_key" ON "mail_registry_candidates"("import_id", "registry_entry_id", "service_domain");

-- CreateIndex
CREATE UNIQUE INDEX "mail_policy_versions_version_key" ON "mail_policy_versions"("version");

-- CreateIndex
CREATE INDEX "mail_policy_entries_version_state_idx" ON "mail_policy_entries"("version_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "mail_policy_entries_version_domain_key" ON "mail_policy_entries"("version_id", "email_domain");

-- CreateIndex
CREATE UNIQUE INDEX "mail_policy_commands_command_id_key" ON "mail_policy_commands"("command_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_policy_audit_events_command_id_key" ON "mail_policy_audit_events"("command_id");

-- CreateIndex
CREATE INDEX "mail_policy_audit_events_occurred_at_idx" ON "mail_policy_audit_events"("occurred_at");

-- AddForeignKey
ALTER TABLE "mail_registry_candidates" ADD CONSTRAINT "mail_registry_candidates_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "mail_registry_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_policy_entries" ADD CONSTRAINT "mail_policy_entries_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "mail_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_policy_entries" ADD CONSTRAINT "mail_policy_entries_source_candidate_id_fkey" FOREIGN KEY ("source_candidate_id") REFERENCES "mail_registry_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
