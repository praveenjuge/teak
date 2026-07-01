"use client";

import { CircleCheck, Download } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { formatBytes, formatCountdown } from "./importExportFormat";

export type ExportJobStatus =
  | "pending"
  | "running"
  | "ready"
  | "failed"
  | "canceled"
  | "expired";

export interface ExportJobSummary {
  artifactBytes?: number;
  cardCount?: number;
  completedAt?: number;
  createdAt: number;
  downloadAvailable: boolean;
  expiresAt?: number;
  failureClass?: string;
  filesIncluded?: number;
  filesOmitted?: number;
  id: string;
  processedCount?: number;
  stage?: "snapshotting" | "archiving";
  status: ExportJobStatus;
  updatedAt: number;
}

export interface ExportState {
  canStartNew: boolean;
  job: ExportJobSummary | null;
  quotaResetMs: number;
}

interface ExportPanelProps {
  exportState: ExportState | null | undefined;
  isLoading: boolean;
  onCancelExport: (jobId: string) => Promise<void>;
  onDownloadExport: (jobId: string) => Promise<void>;
  onStartExport: () => Promise<void>;
}

const ACTIVE_STATUSES: ExportJobStatus[] = ["pending", "running"];

const expiryDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) {
    return "";
  }
  return expiryDateFormatter.format(new Date(expiresAt));
}

export function ExportPanel({
  exportState,
  isLoading,
  onCancelExport,
  onDownloadExport,
  onStartExport,
}: ExportPanelProps) {
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  const job = exportState?.job ?? null;
  const isActive = job ? ACTIVE_STATUSES.includes(job.status) : false;
  const canDownload = Boolean(job?.downloadAvailable);
  const canStartNew = exportState?.canStartNew ?? false;
  const quotaResetMs = exportState?.quotaResetMs ?? 0;

  // Anchor the reset moment when the quota estimate changes, then tick a live
  // countdown so the blocked button stays accurate without a refresh.
  const resetAt = useMemo(() => Date.now() + quotaResetMs, [quotaResetMs]);
  const remainingMs = Math.max(0, resetAt - now);
  const quotaBlocked = !(isLoading || isActive || canDownload || canStartNew);

  useEffect(() => {
    if (!quotaBlocked) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [quotaBlocked]);

  const runAction = async (
    action: () => Promise<void>,
    loadingMessage: string,
    successMessage: string,
    errorMessage: string
  ) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setIsBusy(true);
    const toastId = toast.loading(loadingMessage);
    try {
      await action();
      toast.success(successMessage, { id: toastId });
    } catch {
      toast.error(errorMessage, { id: toastId });
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const handleStart = () =>
    runAction(
      onStartExport,
      "Starting export…",
      "Export started. We'll prepare your archive in the background.",
      "Could not start export."
    );

  const handleCancel = () => {
    if (!job) {
      return;
    }
    return runAction(
      () => onCancelExport(job.id),
      "Canceling export…",
      "Export canceled.",
      "Could not cancel export."
    );
  };

  const handleDownload = () => {
    if (!job) {
      return;
    }
    return runAction(
      () => onDownloadExport(job.id),
      "Preparing download…",
      "Your download is ready.",
      "Could not prepare download."
    );
  };

  const avatarClass =
    "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground";

  let activeTitle = "Preparing your export…";
  let activeSubtitle = "This keeps running in the background.";
  if (job?.stage === "snapshotting" && typeof job.processedCount === "number") {
    activeTitle = "Snapshotting your cards";
    activeSubtitle = `${job.processedCount} card${job.processedCount === 1 ? "" : "s"} captured so far`;
  } else if (job?.stage === "archiving") {
    activeTitle = "Building your archive…";
    activeSubtitle = "Zipping your cards and files.";
  }

  let idleCaption =
    "One export per week, available for 7 days after it's ready.";
  if (job?.status === "failed") {
    idleCaption = "Last export failed. You can try again.";
  } else if (!canStartNew) {
    idleCaption = "You've used this week's export.";
  }

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex items-center justify-center py-6">
        <Spinner />
      </div>
    );
  } else if (isActive) {
    body = (
      <div className="flex items-start gap-3">
        <span className={avatarClass}>
          <Spinner className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="space-y-0.5">
            <div className="font-medium">{activeTitle}</div>
            <div className="text-muted-foreground">{activeSubtitle}</div>
          </div>
          <Button
            disabled={isBusy}
            onClick={handleCancel}
            size="sm"
            variant="destructive"
          >
            {isBusy ? <Spinner /> : "Cancel export"}
          </Button>
        </div>
      </div>
    );
  } else if (canDownload && job) {
    body = (
      <div className="flex items-start gap-3">
        <span className={avatarClass}>
          <CircleCheck className="size-4 text-foreground" />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="space-y-0.5">
            <div className="font-medium">Your export is ready</div>
            <div className="text-muted-foreground">
              <span>{job.cardCount ?? 0} cards</span>
              {typeof job.artifactBytes === "number" ? (
                <span> · {formatBytes(job.artifactBytes)}</span>
              ) : null}
              {job.filesOmitted ? (
                <span title="Some original files couldn't be read at export time and were left out of the archive.">
                  {" "}
                  · {job.filesOmitted} file{job.filesOmitted === 1 ? "" : "s"}{" "}
                  unavailable
                </span>
              ) : null}
              {job.expiresAt ? (
                <span> · available until {formatExpiry(job.expiresAt)}</span>
              ) : null}
            </div>
          </div>
          <Button disabled={isBusy} onClick={handleDownload} size="sm">
            {isBusy ? <Spinner /> : "Download archive"}
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex items-start gap-3">
        <span className={avatarClass}>
          <Download className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="space-y-0.5">
            <div className="font-medium">Export your data</div>
            <p className="text-muted-foreground">
              A ZIP of your active cards and their original files.
            </p>
          </div>
          <div className="space-y-1.5">
            {canStartNew ? (
              <Button disabled={isBusy} onClick={handleStart} size="sm">
                {isBusy ? <Spinner /> : "Start export"}
              </Button>
            ) : (
              <Button
                disabled
                size="sm"
                title={`Next export available ${formatExpiry(resetAt)}`}
                variant="secondary"
              >
                Available in {formatCountdown(remainingMs)}
              </Button>
            )}
            <p className="text-muted-foreground">{idleCaption}</p>
          </div>
        </div>
      </div>
    );
  }

  return <div className="text-sm">{body}</div>;
}
