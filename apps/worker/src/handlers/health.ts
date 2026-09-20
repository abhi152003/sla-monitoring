import { db } from "../db/client";
import { APP_NAME } from "@sla-monitoring/shared";
import { jsonResponse } from "../api/respond";

const SERVICE = "@sla-monitoring/worker";

/** GET /health — worker liveness plus database reachability, without leaking details. */
export async function handleHealth(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  let database: "ok" | "unreachable" = "ok";
  try {
    await db()`SELECT 1`;
  } catch {
    database = "unreachable";
  }
  const body = {
    status: database === "ok" ? "ok" : "degraded",
    service: SERVICE,
    app: APP_NAME,
    database,
    timestamp: new Date().toISOString(),
  };
  return jsonResponse(body, database === "ok" ? 200 : 503, origin);
}
