import { APP_NAME, type ApiError, type HealthResponse } from "@sla-monitoring/shared";

const SERVICE = "@sla-monitoring/worker";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const body: HealthResponse = {
        status: "ok",
        service: SERVICE,
        app: APP_NAME,
        timestamp: new Date().toISOString(),
      };
      return Response.json(body, { status: 200 });
    }

    const error: ApiError = {
      error: "not_found",
      message: `No route for ${request.method} ${url.pathname}`,
    };
    return Response.json(error, { status: 404 });
  },
};
