import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const here = dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader (apps/worker/.env is gitignored). */
function loadLocalEnv(): Record<string, string> {
  const envPath = resolve(here, ".env");
  if (!existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const local = loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL ?? local.DATABASE_URL ?? "";

export default defineConfig({
  schema: "../../database/schema.prisma",
  migrations: {
    path: "../../database/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
