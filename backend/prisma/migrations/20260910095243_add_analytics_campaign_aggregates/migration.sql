-- CreateTable
CREATE TABLE "analytics_campaign_daily_aggregates" (
    "day" DATE NOT NULL,
    "metric" VARCHAR(96) NOT NULL,
    "campaign" VARCHAR(64) NOT NULL,
    "traffic_class" VARCHAR(16) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_campaign_daily_aggregates_pkey" PRIMARY KEY ("day","metric","campaign","traffic_class")
);
