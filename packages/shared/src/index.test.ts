import { describe, expect, it } from "vitest";
import {
  API_ERROR_STATUS,
  APP_NAME,
  DEFAULT_CHECKS_PAGE,
  DEFAULT_CHECKS_PAGE_SIZE,
  MAX_CHECKS_PAGE_SIZE,
  type HealthResponse,
} from "./index";

describe("@sla-monitoring/shared", () => {
  it("exposes the app name constant", () => {
    expect(APP_NAME).toBe("sla-monitoring");
  });

  it("defines the HealthResponse contract shape", () => {
    const health: HealthResponse = {
      status: "ok",
      service: "@sla-monitoring/worker",
      app: APP_NAME,
      timestamp: new Date().toISOString(),
    };
    expect(health.status).toBe("ok");
  });
});

describe("dashboard API constants", () => {
  it("keeps pagination defaults and bounds stable", () => {
    expect(DEFAULT_CHECKS_PAGE).toBe(1);
    expect(DEFAULT_CHECKS_PAGE_SIZE).toBe(50);
    expect(MAX_CHECKS_PAGE_SIZE).toBe(100);
  });

  it("maps query and lifecycle conflicts to stable statuses", () => {
    expect(API_ERROR_STATUS.invalid_query).toBe(400);
    expect(API_ERROR_STATUS.upload_not_completed).toBe(409);
  });
});
