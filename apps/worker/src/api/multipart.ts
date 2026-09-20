import { MAX_UPLOAD_BYTES, UPLOAD_FIELD_NAME } from "@sla-monitoring/shared";

// Multipart boundaries and part headers add a small envelope around the file.
// This is only an early rejection guard; the exact file limit is enforced
// after parsing below.
const MAX_MULTIPART_ENVELOPE_BYTES = 256 * 1024;

export interface MultipartFile {
  fileName: string;
  bytes: Uint8Array;
}

export type MultipartParseResult =
  | { ok: true; file: MultipartFile }
  | { ok: false; code: "malformed_request" | "invalid_file" | "payload_too_large"; message: string };

/**
 * Extract the documented `file` field from a multipart/form-data request.
 * The 5 MB limit is enforced on the bytes actually received.
 */
export async function parseMultipartFile(request: Request): Promise<MultipartParseResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return { ok: false, code: "malformed_request", message: "Expected a multipart/form-data request." };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    const requestBytes = Number(contentLength);
    if (requestBytes > MAX_UPLOAD_BYTES + MAX_MULTIPART_ENVELOPE_BYTES) {
      return {
        ok: false,
        code: "payload_too_large",
        message: `Request is too large to contain a ${MAX_UPLOAD_BYTES} byte CSV file.`,
      };
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, code: "malformed_request", message: "Malformed multipart body." };
  }

  const entry: unknown = form.get(UPLOAD_FIELD_NAME);
  if (!(entry instanceof File)) {
    return {
      ok: false,
      code: "malformed_request",
      message: `Missing file field "${UPLOAD_FIELD_NAME}".`,
    };
  }

  const fileName = entry.name || "upload.csv";
  const type = entry.type || "";
  if (!fileName.toLowerCase().endsWith(".csv") && !type.includes("csv")) {
    return { ok: false, code: "invalid_file", message: "The uploaded file must be a CSV." };
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "payload_too_large",
      message: `File exceeds the ${MAX_UPLOAD_BYTES} byte limit.`,
    };
  }

  return { ok: true, file: { fileName, bytes } };
}
