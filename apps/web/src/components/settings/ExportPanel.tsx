"use client";

import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleCheck, Download } from "vadivam-react";
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

function formatExpiry(locale: string | undefined, expiresAt?: number): string {
  if (!expiresAt) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));
}

export function ExportPanel({
  exportState,
  isLoading,
  onCancelExport,
  onDownloadExport,
  onStartExport,
}: ExportPanelProps) {
  const t = useTranslations("settings.export");
  const tFormat = useTranslations("settings.format");
  const locale = useIntlLocale();
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef<boolean>(false);
  const [now, setNow] = useState(() => Date.now());

  const job = exportState?.job ?? null;
  const isActive = job ? ACTIVE_STATUSES.includes(job.status) : false;
  const canDownload = Boolean(job?.downloadAvailable);
  const canStartNew = exportState?.canStartNew ?? false;
  const quotaResetMs = exportState?.quotaResetMs ?? 0;

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
    runAction(onStartExport, t("starting"), t("started"), t("startFailed"));

  const handleCancel = () => {
    if (!job) {
      return;
    }
    return runAction(
      () => onCancelExport(job.id),
      t("canceling"),
      t("canceled"),
      t("cancelFailed")
    );
  };

  const handleDownload = () => {
    if (!job) {
      return;
    }
    return runAction(
      () => onDownloadExport(job.id),
      t("preparingDownload"),
      t("downloadReady"),
      t("downloadFailed")
    );
  };

  const avatarClass =
    "flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background text-muted-foreground shadow-xs";

  let activeTitle = t("preparing");
  let activeSubtitle = t("runsInBackground");
  if (job?.stage === "snapshotting" && typeof job.processedCount === "number") {
    activeTitle = t("snapshotting");
    activeSubtitle = t("snapshotProgress", { count: job.processedCount });
  } else if (job?.stage === "archiving") {
    activeTitle = t("archiving");
    activeSubtitle = t("zipping");
  }

  let idleCaption = t("quotaCaption");
  if (job?.status === "failed") {
    idleCaption = t("lastFailed");
  } else if (!canStartNew) {
    idleCaption = t("quotaUsed");
  }

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex min-h-24 items-center justify-center">
        <Spinner className="text-muted-foreground" />
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
            <div className="text-muted-foreground text-xs leading-5">
              {activeSubtitle}
            </div>
          </div>
          <Button
            disabled={isBusy}
            onClick={handleCancel}
            size="sm"
            variant="outline"
          >
            {isBusy ? <Spinner /> : t("cancelExport")}
          </Button>
        </div>
      </div>
    );
  } else if (canDownload && job) {
    body = (
      <div className="flex items-start gap-3">
        <span className={avatarClass}>
          <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="space-y-0.5">
            <div className="font-medium">{t("ready")}</div>
            <div className="text-muted-foreground text-xs leading-5">
              <span>{t("cardCount", { count: job.cardCount ?? 0 })}</span>
              {typeof job.artifactBytes === "number" ? (
                <span> · {formatBytes(job.artifactBytes, locale)}</span>
              ) : null}
              {job.filesOmitted ? (
                <span title={t("filesOmittedTitle")}>
                  {" "}
                  · {t("filesUnavailable", { count: job.filesOmitted })}
                </span>
              ) : null}
              {job.expiresAt ? (
                <span>
                  {" "}
                  ·{" "}
                  {t("availableUntil", {
                    date: formatExpiry(locale, job.expiresAt),
                  })}
                </span>
              ) : null}
            </div>
          </div>
          <Button disabled={isBusy} onClick={handleDownload} size="sm">
            {isBusy ? <Spinner /> : t("downloadArchive")}
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
            <div className="font-medium">{t("title")}</div>
            <p className="text-muted-foreground text-xs leading-5">
              {t("description")}
            </p>
          </div>
          <div className="space-y-2">
            {canStartNew ? (
              <Button disabled={isBusy} onClick={handleStart} size="sm">
                {isBusy ? <Spinner /> : t("startExport")}
              </Button>
            ) : (
              <Button
                disabled
                size="sm"
                title={t("nextAvailable", {
                  date: formatExpiry(locale, resetAt),
                })}
                variant="secondary"
              >
                {t("availableIn", {
                  countdown: formatCountdown(remainingMs, tFormat),
                })}
              </Button>
            )}
            <p className="text-muted-foreground text-xs leading-5">
              {idleCaption}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <div className="text-sm">{body}</div>;
}
