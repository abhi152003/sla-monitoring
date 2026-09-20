import { describe, expect, it } from "vitest";
import {
  classifyStatus,
  formatCanonical,
  isOnGrid,
  parseLatency,
  parseTimestamp,
  statusSeverity,
} from "./normalize";

describe("parseTimestamp", () => {
  it("parses ISO UTC Z form", () => {
    const r = parseTimestamp("2025-04-25T12:15:00Z");
    expect(r?.form).toBe("isoUtc");
    expect(r && formatCanonical(r.date)).toBe("2025-04-25T12:15:00Z");
  });

  it("converts +05:30 offset to UTC", () => {
    const r = parseTimestamp("2025-04-10T05:45:00+05:30");
    expect(r?.form).toBe("isoOffset");
    expect(r && formatCanonical(r.date)).toBe("2025-04-10T00:15:00Z");
  });

  it("converts negative offsets to UTC", () => {
    const r = parseTimestamp("2025-04-10T20:15:00-07:00");
    expect(r && formatCanonical(r.date)).toBe("2025-04-11T03:15:00Z");
  });

  it("accepts offsets without a colon", () => {
    const r = parseTimestamp("2025-04-10T05:45:00+0530");
    expect(r && formatCanonical(r.date)).toBe("2025-04-10T00:15:00Z");
  });

  it("parses 10-digit epoch seconds", () => {
    const r = parseTimestamp("1744349400");
    expect(r?.form).toBe("epochSeconds");
    expect(r && formatCanonical(r.date)).toBe("2025-04-11T05:30:00Z");
  });

  it("parses 13-digit epoch milliseconds", () => {
    const r = parseTimestamp("1744349400000");
    expect(r?.form).toBe("epochMilliseconds");
    expect(r && formatCanonical(r.date)).toBe("2025-04-11T05:30:00Z");
  });

  it("rejects 9, 11, and 12 digit epochs", () => {
    expect(parseTimestamp("174434940")).toBeNull();
    expect(parseTimestamp("17443494000")).toBeNull();
    expect(parseTimestamp("174434940000")).toBeNull();
  });

  it("rejects invalid calendar components instead of rolling over", () => {
    expect(parseTimestamp("2025-02-30T00:00:00Z")).toBeNull();
    expect(parseTimestamp("2025-13-01T00:00:00Z")).toBeNull();
    expect(parseTimestamp("2025-04-31T00:00:00Z")).toBeNull();
    expect(parseTimestamp("2025-04-10T24:00:00Z")).toBeNull();
    expect(parseTimestamp("2025-04-10T12:60:00Z")).toBeNull();
  });

  it("rejects garbage strings", () => {
    expect(parseTimestamp("not-a-timestamp")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("2025-04-10")).toBeNull();
    expect(parseTimestamp("-174434940")).toBeNull();
  });

  it("accepts the maximum 13-digit epoch (year 2286)", () => {
    const r = parseTimestamp("9999999999999");
    expect(r?.form).toBe("epochMilliseconds");
  });

  it("is independent of machine timezone (manual Date.UTC construction)", () => {
    // +05:30 with a UTC-crossing date: conversion must not depend on local TZ.
    const r = parseTimestamp("2025-01-01T02:00:00+05:30");
    expect(r && formatCanonical(r.date)).toBe("2024-12-31T20:30:00Z");
  });
});

describe("isOnGrid", () => {
  const at = (s: string) => parseTimestamp(s)!.date;
  it("accepts :00/:15/:30/:45 minute marks", () => {
    expect(isOnGrid(at("2025-04-10T00:00:00Z"))).toBe(true);
    expect(isOnGrid(at("2025-04-10T00:15:00Z"))).toBe(true);
    expect(isOnGrid(at("2025-04-10T00:30:00Z"))).toBe(true);
    expect(isOnGrid(at("2025-04-10T00:45:00Z"))).toBe(true);
  });
  it("rejects off-grid minutes and seconds", () => {
    expect(isOnGrid(at("2025-04-10T00:05:00Z"))).toBe(false);
    expect(isOnGrid(at("2025-04-10T00:00:01Z"))).toBe(false);
  });
  it("rejects epoch milliseconds with a sub-minute remainder", () => {
    const d = new Date(1744349400 * 1000 + 500);
    expect(isOnGrid(d)).toBe(false);
  });
});

describe("parseLatency", () => {
  it("keeps empty latency as null", () => {
    expect(parseLatency("", "ms")).toEqual({ ok: true, latencyMs: null });
    expect(parseLatency("   ", "ms")).toEqual({ ok: true, latencyMs: null });
  });
  it("normalizes seconds to milliseconds with 2-decimal precision", () => {
    expect(parseLatency("0.697", "s")).toEqual({ ok: true, latencyMs: 697 });
    expect(parseLatency("2.452", "s")).toEqual({ ok: true, latencyMs: 2452 });
  });
  it("passes milliseconds through", () => {
    expect(parseLatency("176", "ms")).toEqual({ ok: true, latencyMs: 176 });
  });
  it("rejects negative latency", () => {
    expect(parseLatency("-296", "ms").ok).toBe(false);
  });
  it("rejects non-numeric latency", () => {
    expect(parseLatency("N/A", "ms").ok).toBe(false);
    expect(parseLatency("1e3", "ms").ok).toBe(false);
    expect(parseLatency("12,5", "ms").ok).toBe(false);
  });
});

describe("classifyStatus", () => {
  it("classifies 2xx and 3xx as success", () => {
    expect(classifyStatus(200)).toBe("success");
    expect(classifyStatus(204)).toBe("success");
    expect(classifyStatus(302)).toBe("success");
  });
  it("classifies 4xx and 5xx as failure", () => {
    expect(classifyStatus(404)).toBe("failure");
    expect(classifyStatus(500)).toBe("failure");
    expect(classifyStatus(502)).toBe("failure");
    expect(classifyStatus(503)).toBe("failure");
  });
  it("classifies 999 as an invalid observation", () => {
    expect(classifyStatus(999)).toBe("invalid");
  });
  it("rejects other codes as unsupported", () => {
    expect(classifyStatus(100)).toBe("unsupported");
    expect(classifyStatus(101)).toBe("unsupported");
    expect(classifyStatus(99)).toBe("unsupported");
    expect(classifyStatus(600)).toBe("unsupported");
    expect(classifyStatus(9999)).toBe("unsupported");
  });
});

describe("statusSeverity", () => {
  it("orders 5xx worse than 4xx worse than 3xx worse than 2xx", () => {
    expect(statusSeverity(503)).toBeGreaterThan(statusSeverity(404));
    expect(statusSeverity(404)).toBeGreaterThan(statusSeverity(302));
    expect(statusSeverity(302)).toBeGreaterThan(statusSeverity(200));
  });

  it("treats codes within a class as equally severe", () => {
    expect(statusSeverity(500)).toBe(statusSeverity(503));
    expect(statusSeverity(403)).toBe(statusSeverity(404));
  });
});

describe("formatCanonical", () => {
  it("zero-pads all components and ends with :00Z", () => {
    const d = new Date(Date.UTC(2025, 0, 5, 3, 15, 0));
    expect(formatCanonical(d)).toBe("2025-01-05T03:15:00Z");
  });
});
