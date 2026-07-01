import { useRef, useState } from "react";
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
  status: ExportJobStatus;
  updatedAt: number;
}

export interface ExportState {
  canStartNew: boolean;
  job: ExportJobSummary | null;
  quotaResetMs: number;
}

interface ExportDataDialogProps {
  exportState: ExportState | null | undefined;
  isLoading: boolean;
  onCancelExport: (jobId: string) => Promise<void>;
  onDownloadExport: (jobId: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onStartExport: () => Promise<void>;
  open: boolean;
}

const ACTIVE_STATUSES: ExportJobStatus[] = ["pending", "running"];

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatRelativeDays(ms: number): string {
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) {
    return "less than a day";
  }
  return `${days} days`;
}

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

export function ExportDataDialog({
  exportState,
  isLoading,
  onCancelExport,
  onDownloadExport,
  onOpenChange,
  onStartExport,
  open,
}: ExportDataDialogProps) {
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);

  const job = exportState?.job ?? null;
  const isActive = job ? ACTIVE_STATUSES.includes(job.status) : false;
  const canDownload = Boolean(job?.downloadAvailable);
  const canStartNew = exportState?.canStartNew ?? false;
  const quotaResetMs = exportState?.quotaResetMs ?? 0;

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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-3 p-4 sm:max-w-md">
        <DialogHeader className="gap-1">
          <DialogTitle>Export Your Data</DialogTitle>
          <DialogDescription>
            A ZIP of your active cards and their original files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center p-6">
              <Spinner />
            </div>
          )}

          {!isLoading && isActive && (
            <div className="flex flex-col items-center gap-3 rounded-md border p-4 text-center">
              <Spinner />
              <div className="text-muted-foreground text-sm">
                Preparing your export…
              </div>
              <Button
                disabled={isBusy}
                onClick={handleCancel}
                size="sm"
                variant="ghost"
              >
                {isBusy ? <Spinner /> : "Cancel export"}
              </Button>
            </div>
          )}

          {!(isLoading || isActive) && canDownload && job && (
            <div className="space-y-2 rounded-md border p-4">
              <div className="font-medium text-sm">Your export is ready</div>
              <div className="text-muted-foreground text-xs">
                {job.cardCount ?? 0} cards
                {typeof job.artifactBytes === "number"
                  ? ` · ${formatBytes(job.artifactBytes)}`
                  : ""}
                {job.filesOmitted
                  ? ` · ${job.filesOmitted} file${job.filesOmitted === 1 ? "" : "s"} unavailable`
                  : ""}
                {job.expiresAt ? ` · until ${formatExpiry(job.expiresAt)}` : ""}
              </div>
              <Button disabled={isBusy} onClick={handleDownload} size="sm">
                {isBusy ? <Spinner /> : "Download archive"}
              </Button>
            </div>
          )}

          {!(isLoading || isActive || canDownload) && (
            <div className="space-y-2 rounded-md border p-4">
              {job?.status === "failed" && (
                <div className="text-muted-foreground text-sm">
                  Last export failed. You can try again.
                </div>
              )}
              {job?.status === "canceled" && (
                <div className="text-muted-foreground text-sm">
                  Last export canceled.
                </div>
              )}
              {job?.status === "expired" && (
                <div className="text-muted-foreground text-sm">
                  Previous export expired.
                </div>
              )}
              {canStartNew ? (
                <Button disabled={isBusy} onClick={handleStart} size="sm">
                  {isBusy ? <Spinner /> : "Start export"}
                </Button>
              ) : (
                <Button disabled size="sm" variant="secondary">
                  Available in {formatRelativeDays(quotaResetMs)}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
