"use client";

import { api } from "@teak/convex";
import {
  MAX_ARCHIVE_BYTES,
  MAX_BOOKMARK_BYTES,
  MAX_RAINDROP_BYTES,
} from "@teak/convex/import/constants";
import {
  captureClientException,
  runClientSpan,
} from "@teak/convex/shared/client-telemetry";
import { trackLifecycle, trackUpload } from "@teak/convex/shared/metrics";
import { useAction } from "convex/react";
import {
  Archive,
  Bookmark,
  Copy,
  Download,
  Droplet,
  FileText,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ComponentType,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useQuery } from "../../convexQueryHooks";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { formatBytes, formatRelativeTime } from "./importExportFormat";
import { putParts, type UploadPlan } from "./importUpload";

type ImportMode = "bookmarks" | "archive" | "raindrop";

interface ImportJob {
  completedAt?: number;
  createdCount: number;
  failedCount: number;
  failureClass?: string;
  id: string;
  mode: ImportMode;
  parsedCount: number;
  phase: string;
  processedCount: number;
  reportAvailable: boolean;
  skippedCount: number;
  status:
    | "uploading"
    | "queued"
    | "parsing"
    | "importing"
    | "completed"
    | "failed"
    | "canceled";
  updatedAt: number;
}

interface ImportPanelProps {
  onActiveChange?: (active: boolean) => void;
}

const MODE_META: Record<
  ImportMode,
  {
    accept: string;
    hint: string;
    icon: ComponentType<{ className?: string }>;
    maxBytes: number;
    title: string;
    typeLabel: string;
  }
> = {
  bookmarks: {
    accept: ".html,.htm,text/html",
    hint: "Browser HTML exports, up to 20 MiB",
    icon: Bookmark,
    maxBytes: MAX_BOOKMARK_BYTES,
    title: "Import Bookmarks",
    typeLabel: "Bookmarks HTML",
  },
  archive: {
    accept: ".zip,application/zip",
    hint: "Teak ZIP archives, up to 5 GiB",
    icon: Archive,
    maxBytes: MAX_ARCHIVE_BYTES,
    title: "Import Teak Archive",
    typeLabel: "Teak archive",
  },
  raindrop: {
    accept: ".csv,text/csv",
    hint: "Raindrop CSV exports, up to 20 MiB",
    icon: Droplet,
    maxBytes: MAX_RAINDROP_BYTES,
    title: "Import from Raindrop",
    typeLabel: "Raindrop CSV",
  },
};

const MODE_ORDER: ImportMode[] = ["bookmarks", "archive", "raindrop"];

function isActive(status: ImportJob["status"] | undefined) {
  return (
    status === "uploading" ||
    status === "queued" ||
    status === "parsing" ||
    status === "importing"
  );
}

function validateFile(file: File, mode: ImportMode): string | null {
  const { maxBytes } = MODE_META[mode];
  if (file.size > maxBytes) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  return null;
}

function describeImport(job: ImportJob): string {
  const parts = [`${job.createdCount} created`, `${job.skippedCount} skipped`];
  if (job.failedCount > 0) {
    parts.push(`${job.failedCount} failed`);
  }
  const when = formatRelativeTime(job.completedAt ?? job.updatedAt);
  return `Last import: ${parts.join(", ")} — ${when}`;
}

function describeFailure(job: ImportJob): string | null {
  if (job.status !== "failed") {
    return null;
  }
  return job.failureClass ?? "Import failed. Please try again.";
}

// Overall progress as one monotonic fraction: upload fills the first stretch,
// then parsing/importing carry it to the end (importing uses the real
// processed/parsed ratio when available).
function progressPercent(job: ImportJob, uploadPercent?: number): number {
  switch (job.status) {
    case "uploading":
      return uploadPercent === undefined ? 6 : 6 + uploadPercent * 0.34;
    case "queued":
      return 42;
    case "parsing":
      return 55;
    case "importing":
      return job.parsedCount > 0
        ? 62 + 36 * Math.min(1, job.processedCount / job.parsedCount)
        : 62;
    case "completed":
      return 100;
    default:
      return 100;
  }
}

export function ImportProgressSummary({
  job,
  uploadPercent,
}: {
  job: ImportJob | null;
  uploadPercent?: number;
}) {
  if (!job) {
    return null;
  }
  const active = isActive(job.status);
  const showBar = job.status !== "failed" && job.status !== "canceled";
  const counts = [
    { destructive: false, label: "created", value: job.createdCount },
    { destructive: false, label: "skipped", value: job.skippedCount },
    { destructive: true, label: "failed", value: job.failedCount },
  ].filter((count) => count.value > 0);

  return (
    <div aria-live="polite" className="min-w-0 space-y-2.5 border-t pt-3">
      <div className="flex items-center gap-2">
        {active ? <Spinner className="size-4" /> : null}
        <span className="font-medium">{job.phase}</span>
        {job.status === "uploading" && uploadPercent !== undefined ? (
          <span className="ml-auto text-muted-foreground">
            {uploadPercent}%
          </span>
        ) : null}
      </div>
      {showBar ? (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${progressPercent(job, uploadPercent)}%` }}
          />
        </div>
      ) : null}
      {counts.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 text-muted-foreground">
          {counts.map((count) => (
            <span
              className={count.destructive ? "text-destructive" : undefined}
              key={count.label}
            >
              {count.value} {count.label}
            </span>
          ))}
        </div>
      ) : null}
      {active && job.status !== "uploading" ? (
        <p className="text-muted-foreground">
          You can close this and come back later. Importing continues in the
          background.
        </p>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown, fallback = "Import could not start") {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: unknown } }).data;
    if (typeof data?.message === "string") {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export function ImportPanel({ onActiveChange }: ImportPanelProps) {
  const createUpload = useAction(api.importUpload.createImportUpload);
  const resumeUpload = useAction(api.importUpload.resumeImportUpload);
  const completeUpload = useAction(api.importUpload.completeImportUpload);
  const cancelImport = useAction(api.importUpload.cancelImport);
  const getReportUrl = useAction(api.importUpload.getImportReportUrl);
  const latest = useQuery(api.dataImport.getLatestImport) as
    | ImportJob
    | null
    | undefined;
  const inputRefs = {
    archive: useRef<HTMLInputElement>(null),
    bookmarks: useRef<HTMLInputElement>(null),
    raindrop: useRef<HTMLInputElement>(null),
  };
  const resumeInput = useRef<HTMLInputElement>(null);
  const controllersRef = useRef<Set<AbortController> | null>(null);
  if (!controllersRef.current) {
    controllersRef.current = new Set<AbortController>();
  }
  const controllers = controllersRef.current;
  const observedImportIdRef = useRef<string | null>(null);
  const observedImportStartedAtRef = useRef<number | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number>();
  const [transporting, setTransporting] = useState(false);
  const [pending, setPending] = useState<{
    file: File;
    mode: ImportMode;
  } | null>(null);

  const job = latest ?? null;
  // A persisted "uploading" status only advances while this client is PUTting
  // parts, so an uploading job with no local transfer running means the upload
  // was interrupted (e.g. a page reload) and can be resumed. Server-driven
  // phases stay active regardless of this client.
  const serverProcessing =
    job?.status === "queued" ||
    job?.status === "parsing" ||
    job?.status === "importing";
  const active = transporting || serverProcessing;
  const isResuming = job?.status === "uploading" && !transporting;
  const terminalFailure = job ? describeFailure(job) : null;

  const failureSamples = useQuery(
    api.dataImport.getImportFailureSamples,
    job && !isActive(job.status) && job.failedCount > 0
      ? { jobId: job.id as never }
      : "skip"
  ) as { item: string; reason: string; sourceIndex: number }[] | undefined;

  useEffect(() => {
    if (!(latest && latest.id === observedImportIdRef.current)) {
      return;
    }
    const outcome = (
      {
        canceled: "cancelled",
        completed: "success",
        failed: "failure",
      } as Partial<
        Record<ImportJob["status"], "cancelled" | "success" | "failure">
      >
    )[latest.status];
    if (!outcome) {
      return;
    }
    trackLifecycle({
      durationMs: observedImportStartedAtRef.current
        ? Date.now() - observedImportStartedAtRef.current
        : undefined,
      kind: "import",
      outcome,
    });
    observedImportIdRef.current = null;
    observedImportStartedAtRef.current = null;
  }, [latest]);

  const performUpload = async (file: File, mode: ImportMode) => {
    const startedAt = Date.now();
    trackLifecycle({ kind: "import", outcome: "attempt" });
    trackUpload({
      bytes: file.size,
      fileBucket: "import",
      outcome: "attempt",
      source: "import",
    });
    setTransporting(true);
    setUploadPercent(0);
    onActiveChange?.(true);
    try {
      await runClientSpan(
        {
          attributes: { "file.bucket": "import", mode },
          name: "import.upload",
          operation: "import",
          stage: "import",
        },
        async () => {
          let plan: UploadPlan;
          if (job?.status === "uploading") {
            plan = (await resumeUpload({
              fileName: file.name,
              fileSize: file.size,
              fileLastModified: file.lastModified,
            })) as UploadPlan;
          } else {
            plan = (await createUpload({
              mode,
              fileName: file.name,
              fileSize: file.size,
              fileLastModified: file.lastModified,
            })) as UploadPlan;
          }
          observedImportIdRef.current = plan.jobId;
          observedImportStartedAtRef.current = startedAt;
          await putParts(file, plan, setUploadPercent, controllers);
          await completeUpload({ jobId: plan.jobId as never });
        }
      );
      trackUpload({
        bytes: file.size,
        durationMs: Date.now() - startedAt,
        fileBucket: "import",
        outcome: "success",
        source: "import",
      });
    } catch (error) {
      const cancelled =
        error instanceof DOMException && error.name === "AbortError";
      trackLifecycle({
        durationMs: Date.now() - startedAt,
        kind: "import",
        outcome: cancelled ? "cancelled" : "failure",
      });
      trackUpload({
        bytes: file.size,
        durationMs: Date.now() - startedAt,
        fileBucket: "import",
        outcome: "failure",
        source: "import",
      });
      if (!cancelled) {
        captureClientException(error, { mode, operation: "import.upload" });
        toast.error(errorMessage(error));
      }
      observedImportIdRef.current = null;
      observedImportStartedAtRef.current = null;
    } finally {
      setTransporting(false);
      onActiveChange?.(false);
    }
  };

  // Validate + stage a file for confirmation before any upload starts.
  const stageFile = (file: File, mode: ImportMode) => {
    const error = validateFile(file, mode);
    if (error) {
      toast.error(error);
      return;
    }
    setPending({ file, mode });
  };

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement>,
    mode: ImportMode
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      stageFile(file, mode);
    }
  };

  const handleResumeInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file && job) {
      stageFile(file, job.mode);
    }
  };

  const confirmPending = () => {
    if (!pending) {
      return;
    }
    const { file, mode } = pending;
    setPending(null);
    void performUpload(file, mode);
  };

  const cancel = async () => {
    for (const controller of controllers) {
      controller.abort();
    }
    controllers.clear();
    try {
      if (job) {
        await cancelImport({ jobId: job.id as never });
        trackLifecycle({ kind: "import", outcome: "cancelled" });
      }
    } catch (error) {
      toast.error(errorMessage(error, "Import could not be canceled."));
    } finally {
      setTransporting(false);
      onActiveChange?.(false);
    }
  };

  const copyReport = async () => {
    if (!job) {
      return;
    }
    try {
      const url = await getReportUrl({ jobId: job.id as never });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Import report could not be loaded");
      }
      await navigator.clipboard.writeText(await response.text());
      toast.success("Import report copied.");
    } catch (error) {
      toast.error(errorMessage(error, "Import report could not be copied."));
    }
  };

  const downloadReport = async () => {
    if (!job) {
      return;
    }
    try {
      const url = await getReportUrl({ jobId: job.id as never });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "teak-import-report.txt";
      anchor.click();
    } catch (error) {
      toast.error(
        errorMessage(error, "Import report could not be downloaded.")
      );
    }
  };

  const showIdle = !(active || pending || isResuming);
  const showModes = showIdle && !isResuming;
  // Only surface the "last import" summary when at rest — not while a new
  // import is starting up.
  const terminal = !active && job && !isActive(job.status) ? job : null;
  // Keep the last-import row permanently mounted (in the resting state) so it
  // doesn't pop in a second after the query resolves.
  const lastLoading = latest === undefined;
  const lastText = latest ? describeImport(latest) : "No imports yet.";
  // While the upload is being kicked off, `getLatestImport` may still return the
  // previous (terminal) job for a beat. Show an "Uploading" placeholder until
  // the server reflects the new active job so we never flash a stale phase like
  // "Import failed".
  const progressJob: ImportJob = isActive(job?.status)
    ? (job as ImportJob)
    : {
        id: job?.id ?? "pending",
        mode: pending?.mode ?? job?.mode ?? "bookmarks",
        status: "uploading",
        phase: "Uploading",
        parsedCount: 0,
        processedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        reportAvailable: false,
        updatedAt: Date.now(),
      };

  return (
    <div className="min-w-0 space-y-4 text-sm">
      {pending ? (
        <div className="space-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate font-medium">{pending.file.name}</div>
              <div className="text-muted-foreground">
                {MODE_META[pending.mode].typeLabel} ·{" "}
                {formatBytes(pending.file.size)}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={confirmPending} size="sm">
              {isResuming ? "Resume upload" : "Start import"}
            </Button>
            <Button
              onClick={() => setPending(null)}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {showModes ? (
        <div className="space-y-1">
          {MODE_ORDER.map((mode) => {
            const meta = MODE_META[mode];
            const Icon = meta.icon;
            return (
              <button
                className="-mx-2 flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-muted disabled:opacity-50"
                disabled={active}
                key={mode}
                onClick={() => inputRefs[mode].current?.click()}
                type="button"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium">{meta.title}</span>
                  <span className="block text-muted-foreground">
                    {meta.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {isResuming && !(active || pending) ? (
        <div className="space-y-2">
          <div className="font-medium">Upload interrupted</div>
          <div className="text-muted-foreground">
            Choose the same {MODE_META[job.mode].typeLabel} file to resume where
            it left off.
          </div>
          <Button
            onClick={() => resumeInput.current?.click()}
            size="sm"
            variant="outline"
          >
            <Upload />
            Resume upload
          </Button>
        </div>
      ) : null}

      {MODE_ORDER.map((mode) => (
        <input
          accept={MODE_META[mode].accept}
          aria-label={`Choose a file for ${MODE_META[mode].title}`}
          className="hidden"
          key={`input-${mode}`}
          onChange={(event) => handleInputChange(event, mode)}
          ref={inputRefs[mode]}
          type="file"
        />
      ))}
      <input
        accept=".html,.htm,.zip,.csv"
        aria-label="Choose a file to resume the interrupted upload"
        className="hidden"
        onChange={handleResumeInput}
        ref={resumeInput}
        type="file"
      />

      {active ? (
        <ImportProgressSummary
          job={progressJob}
          uploadPercent={uploadPercent}
        />
      ) : null}

      {active || isResuming ? (
        <Button onClick={() => void cancel()} size="sm" variant="outline">
          Cancel import
        </Button>
      ) : null}

      {showIdle ? (
        <div className="flex min-w-0 items-center gap-2 border-t pt-3 text-muted-foreground">
          {lastLoading ? <Spinner className="size-4" /> : null}
          <span className="min-w-0 break-words">
            {lastLoading ? "Loading last import details…" : lastText}
          </span>
        </div>
      ) : null}

      {terminalFailure ? (
        <div className="min-w-0 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-destructive">
          <div className="font-medium">Import stopped</div>
          <p className="mt-1 break-words">{terminalFailure}</p>
        </div>
      ) : null}

      {terminal && failureSamples && failureSamples.length > 0 ? (
        <div className="min-w-0 space-y-1.5">
          <div className="font-medium">Items that couldn't be imported</div>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {failureSamples.map((sample) => (
              <li
                className="flex min-w-0 items-start gap-2"
                key={`${sample.sourceIndex}-${sample.item}`}
              >
                <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                <span className="min-w-0">
                  <span className="block break-words">{sample.item}</span>
                  <span className="block break-words text-muted-foreground">
                    {sample.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!active && job?.reportAvailable ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            className="min-w-0"
            onClick={() => void copyReport()}
            size="sm"
            variant="outline"
          >
            <Copy />
            Copy error report
          </Button>
          <Button
            className="min-w-0"
            onClick={() => void downloadReport()}
            size="sm"
            variant="outline"
          >
            <Download />
            Download error report
          </Button>
        </div>
      ) : null}
    </div>
  );
}
