import { describe, expect, it } from "vitest";
import { parseMultipartFile } from "../src/api/multipart";
import { MAX_UPLOAD_BYTES } from "@sla-monitoring/shared";

function multipartRequest(file: File | null, fieldName = "file"): Request {
  const form = new FormData();
  if (file) form.append(fieldName, file);
  return new Request("http://worker.local/uploads", { method: "POST", body: form });
}

function csvFile(content: string, name = "checks.csv", type = "text/csv"): File {
  return new File([content], name, { type });
}

describe("parseMultipartFile", () => {
  it("accepts a valid CSV file field", async () => {
    const req = multipartRequest(csvFile("service_id\nsvc-a\n"));
    const result = await parseMultipartFile(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.fileName).toBe("checks.csv");
      expect(new TextDecoder().decode(result.file.bytes)).toContain("service_id");
    }
  });

  it("rejects non-multipart requests", async () => {
    const req = new Request("http://worker.local/uploads", {
      method: "POST",
      body: "plain text",
      headers: { "content-type": "text/plain" },
    });
    const result = await parseMultipartFile(req);
    expect(result).toMatchObject({ ok: false, code: "malformed_request" });
  });

  it("rejects a missing file field", async () => {
    const result = await parseMultipartFile(multipartRequest(null));
    expect(result).toMatchObject({ ok: false, code: "malformed_request" });
  });

  it("rejects a wrongly named field", async () => {
    const result = await parseMultipartFile(
      multipartRequest(csvFile("a\n"), "not_the_field"),
    );
    expect(result).toMatchObject({ ok: false, code: "malformed_request" });
  });

  it("rejects non-CSV files", async () => {
    const result = await parseMultipartFile(
      multipartRequest(new File([new Uint8Array([1, 2, 3])], "data.bin", { type: "application/octet-stream" })),
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_file" });
  });

  it("accepts a csv content type even without the extension", async () => {
    const result = await parseMultipartFile(multipartRequest(csvFile("a\n", "data", "text/csv")));
    expect(result.ok).toBe(true);
  });

  it("enforces the 5MB limit on received bytes", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const result = await parseMultipartFile(
      multipartRequest(new File([big], "big.csv", { type: "text/csv" })),
    );
    expect(result).toMatchObject({ ok: false, code: "payload_too_large" });
  });

  it("rejects an obviously oversized request before parsing its multipart body", async () => {
    const req = multipartRequest(csvFile("service_id\nsvc-a\n"));
    req.headers.set("content-length", String(MAX_UPLOAD_BYTES + 256 * 1024 + 1));

    const result = await parseMultipartFile(req);

    expect(result).toMatchObject({ ok: false, code: "payload_too_large" });
  });
});
