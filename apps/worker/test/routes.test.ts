import { describe, expect, it } from "vitest";
import { allowedMethods, isKnownPath, matchRoute } from "../src/routes";

describe("matchRoute", () => {
  it("routes GET /health", () => {
    expect(matchRoute("GET", "/health")).toEqual({ handler: "health" });
  });
  it("routes POST /uploads", () => {
    expect(matchRoute("POST", "/uploads")).toEqual({ handler: "upload" });
  });
  it("routes GET /uploads/:id and captures the id", () => {
    expect(matchRoute("GET", "/uploads/abc-123")).toEqual({ handler: "getUpload", id: "abc-123" });
  });
  it("rejects wrong methods and unknown paths", () => {
    expect(matchRoute("POST", "/health")).toBeNull();
    expect(matchRoute("GET", "/uploads")).toBeNull();
    expect(matchRoute("DELETE", "/uploads/abc")).toBeNull();
    expect(matchRoute("GET", "/uploads/abc/children")).toBeNull();
    expect(matchRoute("GET", "/nope")).toBeNull();
  });
});

describe("isKnownPath", () => {
  it("recognizes static and parameterized API paths", () => {
    expect(isKnownPath("/health")).toBe(true);
    expect(isKnownPath("/uploads")).toBe(true);
    expect(isKnownPath("/uploads/abc")).toBe(true);
    expect(isKnownPath("/missing")).toBe(false);
  });
});

describe("allowedMethods", () => {
  it("includes OPTIONS for each recognized path", () => {
    expect(allowedMethods("/health")).toBe("GET, OPTIONS");
    expect(allowedMethods("/uploads")).toBe("POST, OPTIONS");
    expect(allowedMethods("/uploads/abc")).toBe("GET, OPTIONS");
    expect(allowedMethods("/missing")).toBeNull();
  });
});
