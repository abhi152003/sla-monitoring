-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "raw_rows" INTEGER,
    "valid_observations" INTEGER,
    "invalid_observations" INTEGER,
    "rejected_rows" INTEGER,
    "duplicate_removals" INTEGER,
    "reconciled_intervals" INTEGER,
    "low_trust" BOOLEAN NOT NULL DEFAULT false,
    "date_range_start" TIMESTAMPTZ,
    "date_range_end" TIMESTAMPTZ,
    "report" JSONB,
    "overall_metrics" JSONB,
    "services_metrics" JSONB,
    "months_metrics" JSONB,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciled_checks" (
    "id" BIGSERIAL NOT NULL,
    "upload_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "check_timestamp" TIMESTAMPTZ NOT NULL,
    "status_code" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "latency_ms" DECIMAL(12,2),
    "agent" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "observation_count" INTEGER NOT NULL,
    "source_row_number" INTEGER NOT NULL,
    "observations" JSONB NOT NULL,

    CONSTRAINT "reconciled_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejected_rows" (
    "id" BIGSERIAL NOT NULL,
    "upload_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "row_values" JSONB NOT NULL,

    CONSTRAINT "rejected_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invalid_observations" (
    "id" BIGSERIAL NOT NULL,
    "upload_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "row_values" JSONB NOT NULL,

    CONSTRAINT "invalid_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_content_hash_key" ON "uploads"("content_hash");

-- CreateIndex
CREATE INDEX "uploads_status_idx" ON "uploads"("status");

-- CreateIndex
CREATE INDEX "reconciled_checks_upload_id_service_id_check_timestamp_idx" ON "reconciled_checks"("upload_id", "service_id", "check_timestamp");

-- CreateIndex
CREATE INDEX "reconciled_checks_upload_id_status_idx" ON "reconciled_checks"("upload_id", "status");

-- CreateIndex
CREATE INDEX "rejected_rows_upload_id_idx" ON "rejected_rows"("upload_id");

-- CreateIndex
CREATE INDEX "rejected_rows_upload_id_reason_idx" ON "rejected_rows"("upload_id", "reason");

-- CreateIndex
CREATE INDEX "invalid_observations_upload_id_idx" ON "invalid_observations"("upload_id");

-- AddForeignKey
ALTER TABLE "reconciled_checks" ADD CONSTRAINT "reconciled_checks_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejected_rows" ADD CONSTRAINT "rejected_rows_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invalid_observations" ADD CONSTRAINT "invalid_observations_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
