import {
  MAX_CHECKS_PAGE_SIZE,
  UPLOAD_FIELD_NAME,
  type HealthCheckResponse,
  type UploadChecksResponse,
  type UploadResponse,
  type UploadStatsResponse,
} from "@sla-monitoring/shared";
import { ApiClientError } from "./errors";
import { buildFilterSearchParams, type DashboardFilters } from "../filters";

const ACCEPT_JSON = { Accept: "application/json" } as const;

function resolveBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_WORKER_URL;
  if (!raw) {
    throw ApiClientError.notConfigured();
  }
  return raw.replace(/\/+$/, "");
}

function buildUrl(path: string, params?: URLSearchParams): string {
  const query = params && params.toString().length > 0 ? `?${params.toString()}` : "";
  return `${resolveBaseUrl()}${path}${query}`;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Core request wrapper: every failure mode (network error, HTTP error body,
 * unreadable JSON) is normalized into an `ApiClientError` with a readable
 * message. Resolves to the parsed response body.
 */
async function requestJson(path: string, init: RequestInit, params?: URLSearchParams): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), init);
  } catch (error) {
    // Not-configured throws synchronously out of buildUrl; it is not a network failure.
    if (error instanceof ApiClientError) throw error;
    throw ApiClientError.network();
  }

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw ApiClientError.fromResponse(response.status, body);
  }
  if (body === null || typeof body !== "object") {
    throw ApiClientError.invalidResponse();
  }
  return body;
}

function requireObject<T>(body: unknown): T {
  if (body === null || typeof body !== "object") {
    throw ApiClientError.invalidResponse();
  }
  return body as T;
}

/** GET /health — returns the parsed body on 200 and on 503 degraded so the header can render it. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthCheckResponse> {
  let response: Response;
  try {
    response = await fetch(buildUrl("/health"), { signal, headers: ACCEPT_JSON });
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw ApiClientError.network();
  }
  const body = await readJsonBody(response);
  const status =
    body !== null && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
  if (status === "ok" || status === "degraded") {
    return body as HealthCheckResponse;
  }
  if (!response.ok) {
    throw ApiClientError.fromResponse(response.status, body);
  }
  throw ApiClientError.invalidResponse();
}

/**
 * POST /uploads — sends the original file bytes as the documented multipart `file`
 * field. Resolves on both 201 (new upload) and 200 (idempotent replay); the
 * `created` flag distinguishes them.
 */
export async function uploadDataset(file: File, signal?: AbortSignal): Promise<UploadResponse> {
  const form = new FormData();
  form.append(UPLOAD_FIELD_NAME, file, file.name);

  const body = await requestJson("/uploads", {
    method: "POST",
    body: form,
    signal,
    headers: ACCEPT_JSON,
  });

  const parsed = requireObject<{ created?: unknown; upload?: unknown }>(body);
  if (typeof parsed.created !== "boolean" || parsed.upload === null || typeof parsed.upload !== "object") {
    throw ApiClientError.invalidResponse();
  }
  return parsed as UploadResponse;
}

/**
 * GET /uploads/:id/stats — dataset-level statistics. The dashboard treats these
 * as a fixed whole-dataset view, so no filter or pagination params are sent.
 */
export async function fetchStats(id: string, signal?: AbortSignal): Promise<UploadStatsResponse> {
  const body = await requestJson(`/uploads/${encodeURIComponent(id)}/stats`, {
    signal,
    headers: ACCEPT_JSON,
  });
  return requireObject<UploadStatsResponse>(body);
}

/** GET /uploads/:id/checks — filtered, server-side paginated reconciled checks. */
export async function fetchChecks(
  id: string,
  filters: DashboardFilters,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<UploadChecksResponse> {
  const params = buildFilterSearchParams(filters);
  params.set("page", String(page));
  params.set("pageSize", String(Math.min(pageSize, MAX_CHECKS_PAGE_SIZE)));

  const body = await requestJson(
    `/uploads/${encodeURIComponent(id)}/checks`,
    { signal, headers: ACCEPT_JSON },
    params,
  );
  return requireObject<UploadChecksResponse>(body);
}
