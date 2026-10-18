"use client";

import { api } from "@teak/convex";
import { captureEvent, resolveSizeBucket } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/client-telemetry";
import {
  describeImportFailure,
  IMPORT_MODES,
  IMPORT_SOURCES,
  type ImportMode,
  importFileMatches,
  importMaxBytes,
} from "@teak/convex/shared/importSources";
import { normalizeErrorClass } from "@teak/convex/shared/telemetry";
import { useAction, useMutation } from "convex/react";
import { Copy, Download, FileText, Upload, X } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "../../convexQueryHooks";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Spinner } from "../ui/spinner";
import { formatBytes, formatRelativeTime } from "./importExportFormat";
import { putParts, type UploadPlan } from "./importUpload";
import { SettingsIconTile } from "./SettingsDialog";

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

const acceptFor = (mode: ImportMode) =>
  IMPORT_SOURCES[mode].extensions.join(",");

const ALL_EXTENSIONS = [
  ...new Set(IMPORT_MODES.flatMap((mode) => IMPORT_SOURCES[mode].extensions)),
].join(",");

function isActive(status: ImportJob["status"] | undefined) {
  return (
    status === "uploading" ||
    status === "queued" ||
    status === "parsing" ||
    status === "importing"
  );
}

function validateFile(file: File, mode: ImportMode): string | null {
  const { extensions, title } = IMPORT_SOURCES[mode];
  if (!importFileMatches(mode, file.name)) {
    return `Choose a ${extensions.join(" or ")} file from ${title}.`;
  }
  const maxBytes = importMaxBytes(mode, file.name);
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
  return describeImportFailure(job.mode, job.failureClass);
}

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
    <div
      aria-live="polite"
      className="min-w-0 space-y-2.5 rounded-xl border p-4"
    >
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

interface PendingImport {
  file: File;
  mode: ImportMode;
}

export type ImportPanelState =
  | { kind: "idle" }
  | { kind: "confirming"; pending: PendingImport; resume: boolean }
  | { kind: "interrupted"; job: ImportJob }
  | { kind: "running"; job: ImportJob };

function uploadStartingJob(mode: ImportMode): ImportJob {
  return {
    id: "pending",
    mode,
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
}

export function importPanelState(
  job: ImportJob | null,
  transporting: boolean,
  pending: PendingImport | null
): ImportPanelState {
  const uploadInterrupted = job?.status === "uploading" && !transporting;
  if (job && isActive(job.status) && !uploadInterrupted) {
    return { kind: "running", job };
  }
  if (transporting) {
    return {
      kind: "running",
      job: uploadStartingJob(job?.mode ?? "bookmarks"),
    };
  }
  if (pending) {
    return { kind: "confirming", pending, resume: uploadInterrupted };
  }
  if (job && uploadInterrupted) {
    return { kind: "interrupted", job };
  }
  return { kind: "idle" };
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
  const recordPart = useMutation(api.dataImport.recordImportPart);
  const cancelImport = useAction(api.importUpload.cancelImport);
  const getReportUrl = useAction(api.importUpload.getImportReportUrl);
  const latest = useQuery(api.dataImport.getLatestImport) as
    | ImportJob
    | null
    | undefined;
  const [source, setSource] = useState<ImportMode>("bookmarks");
  const fileInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const controllersRef = useRef<Set<AbortController> | null>(null);
  if (!controllersRef.current) {
    controllersRef.current = new Set<AbortController>();
  }
  const controllers = controllersRef.current;
  const observedImportIdRef = useRef<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number>();
  const [transporting, setTransporting] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);

  const job = latest ?? null;
  const state = importPanelState(job, transporting, pending);
  const running = state.kind === "running";
  const finishedJob = !running && job && !isActive(job.status) ? job : null;
  const terminalFailure = finishedJob ? describeFailure(finishedJob) : null;

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
    if (latest.status === "completed") {
      captureEvent("import_completed");
    } else if (latest.status === "failed") {
      captureEvent("import_failed", {});
    } else if (latest.status !== "canceled") {
      return;
    }
    observedImportIdRef.current = null;
  }, [latest]);

  const performUpload = async (file: File, mode: ImportMode) => {
    captureEvent("import_started");
    setTransporting(true);
    setUploadPercent(0);
    onActiveChange?.(true);
    try {
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
      await putParts(file, plan, setUploadPercent, controllers, (part) =>
        recordPart({ jobId: plan.jobId as never, ...part })
      );
      await completeUpload({ jobId: plan.jobId as never });
      captureEvent("file_upload_completed", {
        bucket: "import",
        size_bucket: resolveSizeBucket(file.size),
      });
    } catch (error) {
      const cancelled =
        error instanceof DOMException && error.name === "AbortError";
      if (!cancelled) {
        const errorClass = normalizeErrorClass(error);
        captureEvent("file_upload_failed", {
          bucket: "import",
          error_class: errorClass,
          size_bucket: resolveSizeBucket(file.size),
        });
        captureEvent("import_failed", { error_class: errorClass });
        captureClientException(error, { mode, operation: "import.upload" });
        toast.error(errorMessage(error));
      }
      observedImportIdRef.current = null;
    } finally {
      setTransporting(false);
      onActiveChange?.(false);
    }
  };

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

  const lastLoading = latest === undefined;
  let lastText = "No imports yet.";
  if (lastLoading) {
    lastText = "Loading last import details…";
  } else if (latest) {
    lastText = describeImport(latest);
  }

  return (
    <div className="min-w-0 space-y-4 text-sm">
      {state.kind === "confirming" ? (
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex min-w-0 items-center gap-3">
            <SettingsIconTile icon={FileText} />
            <div className="min-w-0">
              <div className="truncate font-medium">
                {state.pending.file.name}
              </div>
              <div className="text-muted-foreground text-xs leading-5">
                {IMPORT_SOURCES[state.pending.mode].title} ·{" "}
                {formatBytes(state.pending.file.size)}
              </div>
            </div>
          </div>
          <div className="flex gap-2 *:flex-1">
            <Button
              onClick={() => setPending(null)}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
            <Button onClick={confirmPending} size="sm">
              {state.resume ? "Resume upload" : "Start import"}
            </Button>
          </div>
        </div>
      ) : null}

      {state.kind === "idle" ? (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="import-source">Import from</Label>
            <Select
              onValueChange={(value) => setSource(value as ImportMode)}
              value={source}
            >
              <SelectTrigger className="w-full" id="import-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPORT_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {IMPORT_SOURCES[mode].title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs leading-5">
              {IMPORT_SOURCES[source].hint} Up to{" "}
              {formatBytes(IMPORT_SOURCES[source].maxBytes)}.
            </p>
          </div>
          <Button onClick={() => fileInput.current?.click()} size="sm">
            <Upload />
            Choose file
          </Button>
        </div>
      ) : null}

      {state.kind === "interrupted" ? (
        <div className="space-y-2 rounded-xl border p-4">
          <div className="font-medium">Upload interrupted</div>
          <div className="text-muted-foreground">
            Choose the same {IMPORT_SOURCES[state.job.mode].title} file to
            resume where it left off.
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

      <input
        accept={acceptFor(source)}
        aria-label={`Choose a file from ${IMPORT_SOURCES[source].title}`}
        className="hidden"
        onChange={(event) => handleInputChange(event, source)}
        ref={fileInput}
        type="file"
      />
      <input
        accept={ALL_EXTENSIONS}
        aria-label="Choose a file to resume the interrupted upload"
        className="hidden"
        onChange={handleResumeInput}
        ref={resumeInput}
        type="file"
      />

      {state.kind === "running" ? (
        <ImportProgressSummary job={state.job} uploadPercent={uploadPercent} />
      ) : null}

      {running ||
      state.kind === "interrupted" ||
      (state.kind === "confirming" && state.resume) ? (
        <Button onClick={() => void cancel()} size="sm" variant="outline">
          Cancel import
        </Button>
      ) : null}

      {state.kind === "idle" ? (
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs leading-5">
          {lastLoading ? <Spinner className="size-4" /> : null}
          <span className="min-w-0 break-words">{lastText}</span>
        </div>
      ) : null}

      {terminalFailure ? (
        <div className="min-w-0 rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-destructive">
          <div className="font-medium">Import stopped</div>
          <p className="mt-1 break-words">{terminalFailure}</p>
        </div>
      ) : null}

      {finishedJob && failureSamples && failureSamples.length > 0 ? (
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

      {!running && job?.reportAvailable ? (
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
