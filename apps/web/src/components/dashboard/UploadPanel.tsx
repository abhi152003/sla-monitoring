"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { MAX_UPLOAD_BYTES, type UploadSummary } from "@sla-monitoring/shared";
import { uploadDataset } from "@/lib/api/client";
import { ApiClientError, describeError } from "@/lib/api/errors";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

type UploadState =
  | { kind: "idle" }
  | { kind: "processing" }
  | { kind: "success"; created: boolean; fileName: string }
  | { kind: "error"; message: string; retryable: boolean };

const NON_RETRYABLE_VALIDATION = { retryable: false } as const;

function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv");
}

export function UploadPanel({
  activeFileName,
  onUploaded,
}: {
  activeFileName: string | null;
  onUploaded: (upload: UploadSummary) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const processing = state.kind === "processing";

  function selectFile(candidate: File | null): void {
    if (candidate === null) {
      setFile(null);
      setState({ kind: "idle" });
      return;
    }
    if (!isCsvFile(candidate)) {
      setFile(null);
      setState({
        kind: "error",
        message: "Only .csv files can be uploaded. Choose a CSV export and try again.",
        ...NON_RETRYABLE_VALIDATION,
      });
      return;
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setState({
        kind: "error",
        message: `The file is ${formatFileSize(candidate.size)}, larger than the 5 MiB upload limit.`,
        ...NON_RETRYABLE_VALIDATION,
      });
      return;
    }
    setFile(candidate);
    setState({ kind: "idle" });
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>): void {
    selectFile(event.target.files?.[0] ?? null);
    // Allow re-selecting the same file after fixing an error.
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault();
    setDragActive(false);
    if (processing) return;
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function startUpload(): Promise<void> {
    if (file === null || processing) return;
    setState({ kind: "processing" });
    try {
      const response = await uploadDataset(file);
      onUploaded(response.upload);
      setState({ kind: "success", created: response.created, fileName: file.name });
    } catch (error) {
      if (error instanceof ApiClientError) {
        setState({ kind: "error", message: error.message, retryable: error.retryable });
      } else {
        setState({ kind: "error", message: describeError(error), retryable: true });
      }
    }
  }

  function openPicker(): void {
    if (!processing) inputRef.current?.click();
  }

  return (
    <section
      aria-labelledby="upload-heading"
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="upload-heading" className="text-sm font-semibold text-card-foreground">
          Dataset upload
        </h2>
        {activeFileName && state.kind !== "processing" ? (
          <button
            type="button"
            onClick={openPicker}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Upload a different dataset
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        One CSV file per upload, up to 5 MiB. The same file uploaded again restores its existing results.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onInputChange}
        className="sr-only"
        aria-label="Choose a CSV dataset file"
        aria-invalid={state.kind === "error" && !state.retryable}
      />

      <button
        type="button"
        onClick={openPicker}
        onDragOver={(event) => {
          event.preventDefault();
          if (!processing) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        disabled={processing}
        className={cn(
          "mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          dragActive ? "border-primary/60 bg-primary/5" : "border-border bg-surface",
          processing && "opacity-60",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
          className="size-7 text-muted-foreground"
        >
          <path
            d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-sm font-medium text-card-foreground">
          Drag and drop your CSV here, or browse to choose a file
        </span>
        <span className="text-xs text-muted-foreground">.csv files only, maximum 5 MiB</span>
      </button>

      {file ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <p className="min-w-0 truncate font-mono text-xs text-card-foreground" title={file.name}>
            {file.name}
            <span className="ml-2 text-muted-foreground">{formatFileSize(file.size)}</span>
          </p>
          <button
            type="button"
            onClick={() => selectFile(null)}
            disabled={processing}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Remove file
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void startUpload()}
          disabled={file === null || processing}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processing ? "Processing dataset…" : "Upload and process"}
        </button>
      </div>

      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {state.kind === "processing" ? (
          <div>
            <p className="flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                className="inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground"
              />
              Processing dataset — this can take a few seconds…
            </p>
            <div
              aria-hidden="true"
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"
            >
              <div className="h-full w-1/4 animate-indeterminate rounded-full bg-primary" />
            </div>
          </div>
        ) : null}

        {state.kind === "success" ? (
          <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-success">
            {state.created
              ? `Dataset uploaded and processed: ${state.fileName}. Statistics and logs below reflect this dataset.`
              : `Identical dataset detected — restored the existing results for ${state.fileName} (idempotent replay).`}
          </p>
        ) : null}

        {state.kind === "error" ? (
          <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
            <p>{state.message}</p>
            {state.retryable ? (
              <button
                type="button"
                onClick={() => void startUpload()}
                disabled={file === null}
                className="mt-2 rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Retry upload
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
