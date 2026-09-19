import { describe, expect, it } from "vitest";
import { APP_NAME, type HealthResponse } from "./index";

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
