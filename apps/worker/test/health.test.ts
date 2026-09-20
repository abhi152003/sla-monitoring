import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client", () => ({
  db: vi.fn(),
}));

import worker from "../src/index";
import { db } from "../src/db/client";

const env = {
  DATABASE_URL: "postgres://test:test@db.local/test",
  ALLOWED_ORIGIN: "http://localhost:3000",
};

beforeEach(() => {
  vi.mocked(db).mockReset();
});

describe("GET /health", () => {
  it("reports ok when the database check passes", async () => {
    const query = () => Promise.resolve([{ "?column?": 1 }]);
    vi.mocked(db).mockReturnValue(query as never);
    const res = await worker.fetch(new Request("http://worker.local/health"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; database: string };
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
  });

  it("reports degraded with 503 when the database is unreachable, without leaking details", async () => {
    vi.mocked(db).mockImplementation(() => {
      throw new Error("connect ECONNREFUSED db.internal.example:5432 postgres://u:pw@h/db");
    });
    const res = await worker.fetch(new Request("http://worker.local/health"), env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; database: string };
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("unreachable");
    const text = JSON.stringify(body);
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("5432");
    expect(text).not.toContain("ECONNREFUSED");
  });
});
