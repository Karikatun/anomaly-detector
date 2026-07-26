-- CreateTable
CREATE TABLE "auth_abuse_buckets" (
    "scope" VARCHAR(32) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "blocked_until" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_abuse_buckets_pkey" PRIMARY KEY ("scope","key_hash")
);

-- CreateIndex
CREATE INDEX "auth_abuse_buckets_expires_at_idx" ON "auth_abuse_buckets"("expires_at");
