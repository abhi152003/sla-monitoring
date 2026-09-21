import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHECKS_PAGE_SIZE,
  MAX_CHECKS_PAGE_SIZE,
  MAX_SERVICE_ID_LENGTH,
} from "@sla-monitoring/shared";
import { InvalidQueryError, parseCheckQuery } from "../src/api/query";

const parse = (query: string, paginated = true) => parseCheckQuery(new URLSearchParams(query), paginated);

describe("parseCheckQuery", () => {
  it("applies checks pagination defaults", () => {
    const result = parse("");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(DEFAULT_CHECKS_PAGE_SIZE);
    expect(result.range.fromInclusive).toBeNull();
  });

  it("normalizes one UTC date to a half-open day", () => {
    const result = parse("date=2024-02-29");
    expect(result.range.fromInclusive).toBe("2024-02-29T00:00:00.000Z");
    expect(result.range.toExclusive).toBe("2024-03-01T00:00:00.000Z");
  });

  it("normalizes inclusive, one-sided ranges", () => {
    expect(parse("from=2025-04-10").range).toMatchObject({
      fromInclusive: "2025-04-10T00:00:00.000Z",
      toExclusive: null,
    });
    expect(parse("to=2025-04-10").range).toMatchObject({
      fromInclusive: null,
      toExclusive: "2025-04-11T00:00:00.000Z",
    });
  });

  it.each([
    "date=2025-02-29",
    "date=2025-04-31",
    "date=04-10-2025",
    "date=2025-04-10&from=2025-04-01",
    "from=2025-04-11&to=2025-04-10",
    "status=unknown",
    "serviceId=",
    "serviceId=%20%20",
    "page=0",
    "page=1.5",
    `pageSize=${MAX_CHECKS_PAGE_SIZE + 1}`,
    "date=2025-04-10&date=2025-04-11",
    "sort=timestamp",
    `page=${Number.MAX_SAFE_INTEGER}&pageSize=100`,
  ])("rejects invalid query %s", (value) => {
    expect(() => parse(value)).toThrow(InvalidQueryError);
  });

  it("accepts bounded service/status and maximum pagination", () => {
    const serviceId = "s".repeat(MAX_SERVICE_ID_LENGTH);
    const result = parse(`serviceId=${serviceId}&status=failure&page=2&pageSize=${MAX_CHECKS_PAGE_SIZE}`);
    expect(result.range).toMatchObject({ serviceId, status: "failure" });
    expect(result).toMatchObject({ page: 2, pageSize: MAX_CHECKS_PAGE_SIZE });
  });

  it("rejects pagination on stats", () => {
    expect(() => parse("page=1", false)).toThrow("Pagination parameters");
  });
});
