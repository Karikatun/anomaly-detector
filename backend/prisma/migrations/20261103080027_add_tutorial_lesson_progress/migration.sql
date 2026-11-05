-- CreateTable
CREATE TABLE "tutorial_completion_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "lesson_id" VARCHAR(32) NOT NULL,
    "version_key" VARCHAR(64) NOT NULL,
    "origin" VARCHAR(16) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tutorial_completion_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tutorial_completion_records_user_lesson_version_key" ON "tutorial_completion_records"("user_id", "lesson_id", "version_key");

-- AddForeignKey
ALTER TABLE "tutorial_completion_records" ADD CONSTRAINT "tutorial_completion_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
