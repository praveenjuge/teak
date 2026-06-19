"use client";

import { api } from "@teak/convex";
import { useAction, useQuery } from "convex/react";
import { Archive, Bookmark, Copy, Download } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";

const UPLOAD_CONCURRENCY = 3;

interface ImportJob {
  createdCount: number;
  failedCount: number;
  id: string;
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
}

interface UploadPlan {
  jobId: string;
  partSize: number;
  parts: Array<{ partNumber: number; url: string }>;
  uploadedParts: number[];
}

interface ImportDialogProps {
  onActiveChange?: (active: boolean) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function isActive(status: ImportJob["status"] | undefined) {
  return (
    status === "uploading" ||
    status === "queued" ||
    status === "parsing" ||
    status === "importing"
  );
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
  return (
    <div aria-live="polite" className="space-y-3 border-t pt-3">
      <div className="flex items-center gap-2 text-sm">
        {isActive(job.status) ? <Spinner /> : null}
        <span className="font-medium">{job.phase}</span>
        {job.status === "uploading" && uploadPercent !== undefined ? (
          <span className="ml-auto text-muted-foreground text-xs">
            {uploadPercent}%
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground text-xs sm:grid-cols-5">
        <span>Parsed {job.parsedCount}</span>
        <span>Processed {job.processedCount}</span>
        <span>Created {job.createdCount}</span>
        <span>Skipped {job.skippedCount}</span>
        <span>Failed {job.failedCount}</span>
      </div>
    </div>
  );
}

export async function putParts(
  file: File,
  plan: UploadPlan,
  onProgress: (percent: number) => void,
  controllers: Set<AbortController>
) {
  const completeBytes = plan.uploadedParts.reduce((total, partNumber) => {
    const start = (partNumber - 1) * plan.partSize;
    return total + Math.min(plan.partSize, file.size - start);
  }, 0);
  let uploadedBytes = completeBytes;
  onProgress(Math.round((uploadedBytes / file.size) * 100));
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const stopWorkers = (error: unknown) => {
    if (failed) {
      return;
    }
    failed = true;
    failure = error;
    for (const controller of controllers) {
      controller.abort();
    }
  };
  const worker = async () => {
    for (;;) {
      if (failed) {
        return;
      }
      const part = plan.parts[nextIndex];
      nextIndex += 1;
      if (!part) {
        return;
      }
      const start = (part.partNumber - 1) * plan.partSize;
      const chunk = file.slice(
        start,
        Math.min(start + plan.partSize, file.size)
      );
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const response = await fetch(part.url, {
          method: "PUT",
          body: chunk,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Upload part ${part.partNumber} failed (${response.status})`
          );
        }
        uploadedBytes += chunk.size;
        onProgress(
          Math.min(100, Math.round((uploadedBytes / file.size) * 100))
        );
      } catch (error) {
        stopWorkers(error);
        return;
      } finally {
        controllers.delete(controller);
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, plan.parts.length) },
      worker
    )
  );
  if (failed) {
    throw failure;
  }
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: unknown } }).data;
    if (typeof data?.message === "string") {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : "Import could not start";
}

export function ImportDialog({
  onActiveChange,
  onOpenChange,
  open,
}: ImportDialogProps) {
  const createUpload = useAction(api.importUpload.createImportUpload);
  const resumeUpload = useAction(api.importUpload.resumeImportUpload);
  const completeUpload = useAction(api.importUpload.completeImportUpload);
  const cancelImport = useAction(api.importUpload.cancelImport);
  const getReportUrl = useAction(api.importUpload.getImportReportUrl);
  const latest = useQuery(api.dataImport.getLatestImport) as
    | ImportJob
    | null
    | undefined;
  const bookmarkInput = useRef<HTMLInputElement>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Set<AbortController>());
  const [uploadPercent, setUploadPercent] = useState<number>();
  const [transporting, setTransporting] = useState(false);
  const job = latest ?? null;
  const active = transporting || isActive(job?.status);

  const selectFile = async (
    event: ChangeEvent<HTMLInputElement>,
    mode: "bookmarks" | "archive"
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
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
      await putParts(file, plan, setUploadPercent, controllers.current);
      await completeUpload({ jobId: plan.jobId as never });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(errorMessage(error));
      }
    } finally {
      setTransporting(false);
      onActiveChange?.(false);
    }
  };

  const cancel = async () => {
    for (const controller of controllers.current) {
      controller.abort();
    }
    controllers.current.clear();
    if (job) {
      await cancelImport({ jobId: job.id as never });
    }
    setTransporting(false);
    onActiveChange?.(false);
  };

  const copyReport = async () => {
    if (!job) {
      return;
    }
    const url = await getReportUrl({ jobId: job.id as never });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Import report could not be loaded");
    }
    await navigator.clipboard.writeText(await response.text());
    toast.success("Import report copied.");
  };

  const downloadReport = async () => {
    if (!job) {
      return;
    }
    const url = await getReportUrl({ jobId: job.id as never });
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "teak-import-report.txt";
    anchor.click();
  };

  const choosingDisabled = active && job?.status !== "uploading";
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto p-4 sm:max-w-lg">
        <DialogHeader className="gap-1">
          <DialogTitle>Import to Teak</DialogTitle>
          <DialogDescription>
            Select a file to upload. Teak handles the import in the background.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y rounded-md border">
          <button
            className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50 disabled:opacity-50"
            disabled={choosingDisabled}
            onClick={() => bookmarkInput.current?.click()}
            type="button"
          >
            <Bookmark className="size-4" />
            <span>
              <span className="block font-medium text-sm">
                Import Bookmarks
              </span>
              <span className="block text-muted-foreground text-xs">
                Browser HTML exports, up to 20 MiB
              </span>
            </span>
          </button>
          <button
            className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50 disabled:opacity-50"
            disabled={choosingDisabled}
            onClick={() => archiveInput.current?.click()}
            type="button"
          >
            <Archive className="size-4" />
            <span>
              <span className="block font-medium text-sm">
                Import Teak Archive
              </span>
              <span className="block text-muted-foreground text-xs">
                Teak ZIP archives, up to 5 GiB
              </span>
            </span>
          </button>
        </div>
        <input
          accept=".html,.htm,text/html"
          className="hidden"
          onChange={(event) => void selectFile(event, "bookmarks")}
          ref={bookmarkInput}
          type="file"
        />
        <input
          accept=".zip,application/zip"
          className="hidden"
          onChange={(event) => void selectFile(event, "archive")}
          ref={archiveInput}
          type="file"
        />
        {job?.status === "uploading" && !transporting ? (
          <p className="text-muted-foreground text-xs">
            Select the same file again to resume the upload.
          </p>
        ) : null}
        <ImportProgressSummary job={job} uploadPercent={uploadPercent} />
        {active ? (
          <Button onClick={() => void cancel()} size="sm" variant="outline">
            Cancel import
          </Button>
        ) : null}
        {!active && job?.reportAvailable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void copyReport()}
              size="sm"
              variant="outline"
            >
              <Copy />
              Copy error report
            </Button>
            <Button
              onClick={() => void downloadReport()}
              size="sm"
              variant="outline"
            >
              <Download />
              Download error report
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
