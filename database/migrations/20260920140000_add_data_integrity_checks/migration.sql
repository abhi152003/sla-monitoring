-- Keep lifecycle values and persisted metrics within the API contract.
ALTER TABLE "uploads"
  ADD CONSTRAINT "uploads_status_check"
    CHECK ("status" IN ('processing', 'completed', 'failed')),
  ADD CONSTRAINT "uploads_byte_size_nonnegative_check"
    CHECK ("byte_size" >= 0),
  ADD CONSTRAINT "uploads_raw_rows_nonnegative_check"
    CHECK ("raw_rows" IS NULL OR "raw_rows" >= 0),
  ADD CONSTRAINT "uploads_valid_observations_nonnegative_check"
    CHECK ("valid_observations" IS NULL OR "valid_observations" >= 0),
  ADD CONSTRAINT "uploads_invalid_observations_nonnegative_check"
    CHECK ("invalid_observations" IS NULL OR "invalid_observations" >= 0),
  ADD CONSTRAINT "uploads_rejected_rows_nonnegative_check"
    CHECK ("rejected_rows" IS NULL OR "rejected_rows" >= 0),
  ADD CONSTRAINT "uploads_duplicate_removals_nonnegative_check"
    CHECK ("duplicate_removals" IS NULL OR "duplicate_removals" >= 0),
  ADD CONSTRAINT "uploads_reconciled_intervals_nonnegative_check"
    CHECK ("reconciled_intervals" IS NULL OR "reconciled_intervals" >= 0),
  ADD CONSTRAINT "uploads_date_range_order_check"
    CHECK ("date_range_start" IS NULL OR "date_range_end" IS NULL OR "date_range_start" <= "date_range_end"),
  ADD CONSTRAINT "uploads_completed_at_order_check"
    CHECK ("completed_at" IS NULL OR "completed_at" >= "created_at");

ALTER TABLE "reconciled_checks"
  ADD CONSTRAINT "reconciled_checks_status_check"
    CHECK ("status" IN ('success', 'failure')),
  ADD CONSTRAINT "reconciled_checks_latency_nonnegative_check"
    CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
  ADD CONSTRAINT "reconciled_checks_observation_count_positive_check"
    CHECK ("observation_count" > 0),
  ADD CONSTRAINT "reconciled_checks_source_row_number_positive_check"
    CHECK ("source_row_number" > 0);

ALTER TABLE "rejected_rows"
  ADD CONSTRAINT "rejected_rows_row_number_positive_check"
    CHECK ("row_number" > 0);

ALTER TABLE "invalid_observations"
  ADD CONSTRAINT "invalid_observations_row_number_positive_check"
    CHECK ("row_number" > 0);
