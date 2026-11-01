"use client";

import { api } from "@teak/convex";
import { captureEvent, resolveSizeBucket } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import {
  IMPORT_FAILURE,
  IMPORT_MODES,
  IMPORT_PICKER_MODES,
  IMPORT_SOURCES,
  type ImportMode,
  importFileMatches,
  importMaxBytes,
} from "@teak/convex/shared/importSources";
import { normalizeErrorClass } from "@teak/convex/shared/telemetry";
import type { englishMessages, TeakTranslator } from "@teak/i18n";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Copy,
  Download,
  FileText,
  Upload,
  X,
} from "vadivam-react";
import { useServerErrors } from "../../hooks/useServerErrors";
import { useQuery } from "../../lib/convexQueryHooks";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Spinner } from "../ui/spinner";
import {
  type FormatTranslator,
  formatBytes,
  formatRelativeTime,
} from "./importExportFormat";
import { putParts, type UploadPlan } from "./importUpload";
import { SettingsSection } from "./SettingsSection";

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

type ImportTranslator = TeakTranslator<"settings.import">;

// The server writes each phase in English; these are the ones it writes.
const PHASE_KEYS: Record<
  string,
  keyof typeof englishMessages.settings.import.phases
> = {
  Uploading: "uploading",
  "Waiting to parse": "waitingToParse",
  "Parsing import file": "parsing",
  "Importing cards": "importing",
  "Waiting for card rate limit": "waitingForRateLimit",
  "Canceling import": "canceling",
  "Import complete": "complete",
  "Import failed": "failed",
  "Import canceled": "canceled",
};

const phaseLabel = (t: ImportTranslator, phase: string) => {
  const key = PHASE_KEYS[phase];
  return key ? t(`phases.${key}`) : phase;
};

// Column names and sample values people copy into a spreadsheet; they stay
// English like the header names Teak reads.
const CSV_EXAMPLE = [
  "url,title,tags,folder,note,created",
  'https://example.com,Example,"design, type",Work/Design,A note,2024-05-01',
].join("\n");

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

function validateFile(
  file: File,
  mode: ImportMode,
  t: ImportTranslator,
  locale?: string
): string | null {
  if (!importFileMatches(mode, file.name)) {
    return t("wrongFile", {
      extensions: IMPORT_SOURCES[mode].extensions.join(t("extensionSeparator")),
      source: t(`sources.${mode}.title`),
    });
  }
  const maxBytes = importMaxBytes(mode, file.name);
  if (file.size > maxBytes) {
    return t("fileTooLarge", {
      size: formatBytes(file.size, locale),
      limit: formatBytes(maxBytes, locale),
    });
  }
  if (file.size === 0) {
    return t("fileEmpty");
  }
  return null;
}

function describeImport(
  job: ImportJob,
  t: ImportTranslator,
  tFormat: FormatTranslator,
  locale: string | undefined
): string {
  return t("lastImport", {
    created: job.createdCount,
    skipped: job.skippedCount,
    failed: job.failedCount,
    when: formatRelativeTime(
      job.completedAt ?? job.updatedAt,
      Date.now(),
      tFormat,
      locale
    ),
  });
}

function describeFailure(job: ImportJob, t: ImportTranslator): string | null {
  if (job.status !== "failed") {
    return null;
  }
  const { failureClass, mode } = job;
  if (failureClass === IMPORT_FAILURE.INVALID_SOURCE) {
    if (mode === "archive") {
      return t("failure.invalidArchive");
    }
    if (mode === "links") {
      return t("failure.noLinks");
    }
    return t("failure.invalidSource", {
      article: /^[aeiou]/i.test(IMPORT_SOURCES[mode].name) ? "an" : "a",
      source: t(`sources.${mode}.name`),
    });
  }
  if (failureClass === IMPORT_FAILURE.TOO_MANY_ITEMS) {
    return t("failure.tooManyItems");
  }
  if (failureClass === IMPORT_FAILURE.MISSING_URL_COLUMN) {
    return t("failure.missingUrlColumn");
  }
  if (failureClass && /\s/.test(failureClass)) {
    return failureClass;
  }
  return t("failure.generic");
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
  const t = useTranslations("settings.import");
  if (!job) {
    return null;
  }
  const active = isActive(job.status);
  const showBar = job.status !== "failed" && job.status !== "canceled";
  const counts = (
    [
      { destructive: false, label: "created", value: job.createdCount },
      { destructive: false, label: "skipped", value: job.skippedCount },
      { destructive: true, label: "failed", value: job.failedCount },
    ] as const
  ).filter((count) => count.value > 0);

  return (
    <div
      aria-live="polite"
      className="min-w-0 space-y-2.5 rounded-xl border p-4"
    >
      <div className="flex items-center gap-2">
        {active ? <Spinner className="size-4" /> : null}
        <span className="font-medium">{phaseLabel(t, job.phase)}</span>
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
              {t(count.label, { count: count.value })}
            </span>
          ))}
        </div>
      ) : null}
      {active && job.status !== "uploading" ? (
        <p className="text-muted-foreground">{t("continuesInBackground")}</p>
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

export function ImportSourceHint({ mode }: { mode: ImportMode }) {
  const t = useTranslations("settings.import");
  const locale = useIntlLocale();
  return (
    <>
      <p className="text-muted-foreground text-xs leading-5">
        {t(`sources.${mode}.hint`)}{" "}
        {t("upTo", {
          size: formatBytes(IMPORT_SOURCES[mode].maxBytes, locale),
        })}
      </p>
      {mode === "csv" ? (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-muted-foreground text-xs leading-5 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronRight className="size-3.5 transition-transform duration-200 ease-out group-data-[state=open]:rotate-90" />
            {t("csvExample")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1.5 overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs leading-5">
              {CSV_EXAMPLE}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </>
  );
}

export function ImportPanel({ onActiveChange }: ImportPanelProps) {
  const t = useTranslations("settings.import");
  const tData = useTranslations("settings.data");
  const tc = useTranslations("common");
  const tFormat = useTranslations("settings.format");
  const locale = useIntlLocale();
  const serverErrors = useServerErrors();
  const errorMessage = (error: unknown, fallback = t("startFailed")) =>
    serverErrors.message(
      error,
      error instanceof Error ? error.message : fallback
    );
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
  const [dragging, setDragging] = useState(false);
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
  const terminalFailure = finishedJob ? describeFailure(finishedJob, t) : null;

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
    const error = validateFile(file, mode, t, locale);
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
      toast.error(errorMessage(error, t("cancelFailed")));
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
        throw new Error(t("reportLoadFailed"));
      }
      await navigator.clipboard.writeText(await response.text());
      toast.success(t("reportCopied"));
    } catch (error) {
      toast.error(errorMessage(error, t("reportCopyFailed")));
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
      toast.error(errorMessage(error, t("reportDownloadFailed")));
    }
  };

  const lastLoading = latest === undefined;
  let lastText = "";
  if (lastLoading) {
    lastText = t("loadingLast");
  } else if (latest) {
    lastText = describeImport(latest, t, tFormat, locale);
  }

  const dropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      stageFile(file, source);
    }
  };

  return (
    <SettingsSection
      description={tData("importDescription")}
      id="import"
      title={tData("importTitle")}
    >
      <div className="min-w-0 space-y-4 text-sm">
        {state.kind === "confirming" ? (
          <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
            <FileText className="size-[18px] shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {state.pending.file.name}
              </div>
              <div className="text-muted-foreground text-xs leading-5">
                {t(`sources.${state.pending.mode}.title`)} ·{" "}
                {formatBytes(state.pending.file.size, locale)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setPending(null)}
                size="sm"
                variant="outline"
              >
                {tc("cancel")}
              </Button>
              <Button onClick={confirmPending} size="sm">
                {state.resume ? t("resumeUpload") : t("startImport")}
              </Button>
            </div>
          </div>
        ) : null}

        {state.kind === "idle" ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is a shortcut; "Choose file" does the same with the keyboard.
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: as above
          <div
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
              dragging && "border-primary bg-primary/5"
            )}
            data-no-drop=""
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDrop={dropFile}
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Upload className="size-4" />
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Label className="sr-only" htmlFor="import-source">
                {t("importFrom")}
              </Label>
              <Select
                onValueChange={(value) => setSource(value as ImportMode)}
                value={source}
              >
                <SelectTrigger
                  className="min-w-44"
                  id="import-source"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_PICKER_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`sources.${mode}.title`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => fileInput.current?.click()} size="sm">
                {t("chooseFile")}
              </Button>
              <span className="text-muted-foreground text-xs">
                {t("orDrop")}
              </span>
            </div>
            <div className="max-w-md space-y-1">
              <ImportSourceHint mode={source} />
            </div>
          </div>
        ) : null}

        {state.kind === "interrupted" ? (
          <div className="space-y-2 rounded-xl border p-4">
            <div className="font-medium">{t("uploadInterrupted")}</div>
            <div className="text-muted-foreground">
              {t("resumeHint", {
                source: t(`sources.${state.job.mode}.title`),
              })}
            </div>
            <Button
              onClick={() => resumeInput.current?.click()}
              size="sm"
              variant="outline"
            >
              <Upload />
              {t("resumeUpload")}
            </Button>
          </div>
        ) : null}

        <input
          accept={acceptFor(source)}
          aria-label={t("chooseFileFrom", {
            source: t(`sources.${source}.title`),
          })}
          className="hidden"
          onChange={(event) => handleInputChange(event, source)}
          ref={fileInput}
          type="file"
        />
        <input
          accept={ALL_EXTENSIONS}
          aria-label={t("chooseResumeFile")}
          className="hidden"
          onChange={handleResumeInput}
          ref={resumeInput}
          type="file"
        />

        {state.kind === "running" ? (
          <ImportProgressSummary
            job={state.job}
            uploadPercent={uploadPercent}
          />
        ) : null}

        {running ||
        state.kind === "interrupted" ||
        (state.kind === "confirming" && state.resume) ? (
          <Button onClick={() => void cancel()} size="sm" variant="outline">
            {t("cancelImport")}
          </Button>
        ) : null}

        {state.kind === "idle" && latest !== null ? (
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs leading-5">
            {lastLoading ? <Spinner className="size-4" /> : null}
            <span className="min-w-0 break-words">{lastText}</span>
          </div>
        ) : null}

        {terminalFailure ? (
          <div className="min-w-0 rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-destructive">
            <div className="font-medium">{t("importStopped")}</div>
            <p className="mt-1 break-words">{terminalFailure}</p>
          </div>
        ) : null}

        {finishedJob && failureSamples && failureSamples.length > 0 ? (
          <div className="min-w-0 space-y-1.5">
            <div className="font-medium">{t("failedItems")}</div>
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
              {t("copyReport")}
            </Button>
            <Button
              className="min-w-0"
              onClick={() => void downloadReport()}
              size="sm"
              variant="outline"
            >
              <Download />
              {t("downloadReport")}
            </Button>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
