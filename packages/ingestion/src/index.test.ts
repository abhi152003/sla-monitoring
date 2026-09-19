import { describe, expect, it } from "vitest";
import { INGESTION_STATUS } from "./index";

describe("@sla-monitoring/ingestion", () => {
  it("is a placeholder with no behavior yet", () => {
    expect(INGESTION_STATUS.ready).toBe(false);
    expect(INGESTION_STATUS.note).toContain("later work orders");
  });
});
