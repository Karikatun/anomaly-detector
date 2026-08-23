-- CreateTable
CREATE TABLE "analytics_journeys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "journey_key" CHAR(64) NOT NULL,
    "grant_command_key" CHAR(64) NOT NULL,
    "source_category" VARCHAR(16) NOT NULL,
    "traffic_class" VARCHAR(16) NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "journey_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily_aggregates" (
    "day" DATE NOT NULL,
    "metric" VARCHAR(96) NOT NULL,
    "source_category" VARCHAR(16) NOT NULL,
    "traffic_class" VARCHAR(16) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_daily_aggregates_pkey" PRIMARY KEY ("day","metric","source_category","traffic_class")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_journeys_journey_key_key" ON "analytics_journeys"("journey_key");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_journeys_grant_command_key_key" ON "analytics_journeys"("grant_command_key");

-- CreateIndex
CREATE INDEX "analytics_journeys_expires_at_idx" ON "analytics_journeys"("expires_at");

-- CreateIndex
CREATE INDEX "analytics_events_occurred_at_idx" ON "analytics_events"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_journey_id_kind_key" ON "analytics_events"("journey_id", "kind");

-- CreateIndex
CREATE INDEX "analytics_daily_aggregates_day_metric_traffic_idx" ON "analytics_daily_aggregates"("day", "metric", "traffic_class");

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "analytics_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
