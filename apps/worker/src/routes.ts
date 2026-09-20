export type RouteMatch =
  | { handler: "health" }
  | { handler: "upload" }
  | { handler: "getUpload"; id: string }
  | null;

/** Pure route table, independently unit-testable. */
export function matchRoute(method: string, pathname: string): RouteMatch {
  if (method === "GET" && pathname === "/health") return { handler: "health" };
  if (method === "POST" && pathname === "/uploads") return { handler: "upload" };

  if (method === "GET") {
    const m = /^\/uploads\/([^/]+)$/.exec(pathname);
    if (m) return { handler: "getUpload", id: m[1] };
  }
  return null;
}

/** Whether the path exists independently of the request method. */
export function isKnownPath(pathname: string): boolean {
  return pathname === "/health" || pathname === "/uploads" || /^\/uploads\/[^/]+$/.test(pathname);
}

/** Methods accepted for a known path, including the shared CORS preflight. */
export function allowedMethods(pathname: string): string | null {
  if (pathname === "/health" || /^\/uploads\/[^/]+$/.test(pathname)) return "GET, OPTIONS";
  if (pathname === "/uploads") return "POST, OPTIONS";
  return null;
}
