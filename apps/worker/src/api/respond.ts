import { getEnv } from "../env";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

/** Reflect exactly the configured origin; never a wildcard. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = getEnv().ALLOWED_ORIGIN;
  if (!origin || !allowed || origin !== allowed) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": allowed, ...CORS_HEADERS };
}

export function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export function preflightResponse(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
