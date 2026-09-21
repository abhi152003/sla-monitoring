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
  it("routes upload statistics and checks", () => {
    expect(matchRoute("GET", "/uploads/abc-123/stats")).toEqual({ handler: "getStats", id: "abc-123" });
    expect(matchRoute("GET", "/uploads/abc-123/checks")).toEqual({ handler: "getChecks", id: "abc-123" });
  });
  it("rejects wrong methods and unknown paths", () => {
    expect(matchRoute("POST", "/health")).toBeNull();
    expect(matchRoute("GET", "/uploads")).toBeNull();
    expect(matchRoute("DELETE", "/uploads/abc")).toBeNull();
    expect(matchRoute("GET", "/uploads/abc/children")).toBeNull();
    expect(matchRoute("GET", "/nope")).toBeNull();
    expect(matchRoute("POST", "/uploads/abc-123/stats")).toBeNull();
    expect(matchRoute("DELETE", "/uploads/abc-123/checks")).toBeNull();
    expect(matchRoute("PUT", "/uploads/abc-123/stats")).toBeNull();
  });
});

describe("isKnownPath", () => {
  it("recognizes static and parameterized API paths", () => {
    expect(isKnownPath("/health")).toBe(true);
    expect(isKnownPath("/uploads")).toBe(true);
    expect(isKnownPath("/uploads/abc")).toBe(true);
    expect(isKnownPath("/uploads/abc/stats")).toBe(true);
    expect(isKnownPath("/uploads/abc/checks")).toBe(true);
    expect(isKnownPath("/uploads/abc/evidence")).toBe(false);
    expect(isKnownPath("/missing")).toBe(false);
  });
});

describe("allowedMethods", () => {
  it("includes OPTIONS for each recognized path", () => {
    expect(allowedMethods("/health")).toBe("GET, OPTIONS");
    expect(allowedMethods("/uploads")).toBe("POST, OPTIONS");
    expect(allowedMethods("/uploads/abc")).toBe("GET, OPTIONS");
    expect(allowedMethods("/uploads/abc/stats")).toBe("GET, OPTIONS");
    expect(allowedMethods("/uploads/abc/checks")).toBe("GET, OPTIONS");
    expect(allowedMethods("/missing")).toBeNull();
  });
});
