import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { getEnv } from "../env";

let cached: NeonQueryFunction<false, false> | null = null;

/** Neon HTTP client (fetch-based, safe to cache across requests).
 *  DATABASE_URL comes from .dev.vars locally and a Worker secret when deployed. */
export function db(): NeonQueryFunction<false, false> {
  const url = getEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!cached) cached = neon(url);
  return cached;
}
