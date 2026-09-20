import { allowedMethods, isKnownPath, matchRoute } from "./routes";
import { handleHealth } from "./handlers/health";
import { handleUpload } from "./handlers/upload";
import { handleGetUpload } from "./handlers/getUpload";
import { apiError, internalError } from "./api/errors";
import { jsonResponse, preflightResponse } from "./api/respond";
import { setEnv, type WorkerEnv } from "./env";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    setEnv(env);
    if (request.method === "OPTIONS") return preflightResponse(request.headers.get("Origin"));

    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);

    try {
      switch (route?.handler) {
        case "health":
          return await handleHealth(request);
        case "upload":
          return await handleUpload(request);
        case "getUpload":
          return await handleGetUpload(route.id, request);
        default: {
          const code = isKnownPath(url.pathname) ? "method_not_allowed" : "not_found";
          const err = apiError(
            code,
            code === "method_not_allowed"
              ? `Method ${request.method} is not allowed for ${url.pathname}.`
              : `No route for ${request.method} ${url.pathname}.`,
          );
          const response = jsonResponse(err.body, err.status, request.headers.get("Origin"));
          const allow = allowedMethods(url.pathname);
          if (allow !== null) response.headers.set("Allow", allow);
          return response;
        }
      }
    } catch (e) {
      const err = internalError(e);
      return jsonResponse(err.body, err.status, request.headers.get("Origin"));
    }
  },
};
