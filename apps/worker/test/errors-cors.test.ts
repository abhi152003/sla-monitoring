import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, fileErrorToApi, internalError } from "../src/api/errors";
import { corsHeaders, jsonResponse, preflightResponse } from "../src/api/respond";

afterEach(() => vi.restoreAllMocks());

describe("apiError", () => {
  it("maps every code to its documented HTTP status", () => {
    expect(apiError("malformed_request", "x").status).toBe(400);
    expect(apiError("invalid_file", "x").status).toBe(400);
    expect(apiError("payload_too_large", "x").status).toBe(413);
    expect(apiError("not_found", "x").status).toBe(404);
    expect(apiError("method_not_allowed", "x").status).toBe(405);
    expect(apiError("upload_conflict", "x").status).toBe(409);
    expect(apiError("invalid_csv", "x").status).toBe(422);
    expect(apiError("internal_error", "x").status).toBe(500);
  });
});

describe("fileErrorToApi", () => {
  it("maps ingestion file errors to 422 invalid_csv with the detail code", () => {
    const err = fileErrorToApi({
      code: "missing_columns",
      message: "Missing required columns: agent.",
      missingColumns: ["agent"],
    });
    expect(err.status).toBe(422);
    expect(err.body.error).toBe("invalid_csv");
    expect(err.body.message).toContain("missing_columns");
  });
});

describe("internalError", () => {
  it("never leaks driver internals from a NeonDbError-like failure", () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => logged.push(args));
    const hostile = new Error("connect ECONNREFUSED 1.2.3.4:5432 postgres://user:secret@host/db");
    hostile.name = "Neon password=secret postgres://user:secret@host/db";
    hostile.stack = "Error: at /worker/src/db/client.ts:7";
    const err = internalError(hostile);
    const body = JSON.stringify(err.body);
    expect(body).not.toContain("secret");
    expect(body).not.toContain("postgres://");
    expect(body).not.toContain("1.2.3.4");
    expect(body).not.toContain("client.ts");
    expect(err.status).toBe(500);
    const logText = JSON.stringify(logged);
    expect(logText).not.toContain("secret");
    expect(logText).not.toContain("postgres://");
    expect(logText).not.toContain("1.2.3.4");
    expect(logText).not.toContain("client.ts");
  });
});

describe("CORS", () => {
  it("reflects exactly the configured origin", () => {
    const headers = corsHeaders("http://localhost:3000");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
  });

  it("never emits a wildcard and omits ACAO for other origins", () => {
    const headers = corsHeaders("https://evil.example");
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    const all = Object.values(headers).join(" ");
    expect(all).not.toContain("*");
  });

  it("omits ACAO when no origin header is present", () => {
    expect(corsHeaders(null)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("preflight returns 204 with CORS headers", () => {
    const res = preflightResponse("http://localhost:3000");
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("jsonResponse attaches CORS headers", () => {
    const res = jsonResponse({ ok: true }, 200, "http://localhost:3000");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});
