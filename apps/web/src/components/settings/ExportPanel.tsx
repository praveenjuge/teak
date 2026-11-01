"use client";

import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CircleCheck } from "vadivam-react";
import { useLocalDateFormat } from "../../hooks/useLocalDateFormat";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { formatBytes, formatCountdown } from "./importExportFormat";
import { SettingsSection } from "./SettingsSection";

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

const EXPIRY_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

export function ExportPanel({
  exportState,
  isLoading,
  onCancelExport,
  onDownloadExport,
  onStartExport,
}: ExportPanelProps) {
  const t = useTranslations("settings.export");
  const tData = useTranslations("settings.data");
  const tFormat = useTranslations("settings.format");
  const locale = useIntlLocale();
  const formatDate = useLocalDateFormat(EXPIRY_FORMAT);
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

  let action: ReactNode;
  let status: ReactNode;
  if (isLoading) {
    action = <Spinner className="text-muted-foreground" />;
    status = null;
  } else if (isActive) {
    action = (
      <Button
        disabled={isBusy}
        onClick={handleCancel}
        size="sm"
        variant="outline"
      >
        {isBusy ? <Spinner /> : t("cancelExport")}
      </Button>
    );
    status = (
      <>
        <Spinner className="size-4 shrink-0" />
        <span className="font-medium text-foreground">{activeTitle}</span>
        <span>{activeSubtitle}</span>
      </>
    );
  } else if (canDownload && job) {
    action = (
      <Button disabled={isBusy} onClick={handleDownload} size="sm">
        {isBusy ? <Spinner /> : t("downloadArchive")}
      </Button>
    );
    status = (
      <>
        <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="font-medium text-foreground">{t("ready")}</span>
        <span>{t("cardCount", { count: job.cardCount ?? 0 })}</span>
        {typeof job.artifactBytes === "number" ? (
          <span>{formatBytes(job.artifactBytes, locale)}</span>
        ) : null}
        {job.filesOmitted ? (
          <span title={t("filesOmittedTitle")}>
            {t("filesUnavailable", { count: job.filesOmitted })}
          </span>
        ) : null}
        {job.expiresAt && formatDate ? (
          <span>
            {t("availableUntil", { date: formatDate(job.expiresAt) })}
          </span>
        ) : null}
      </>
    );
  } else {
    action = canStartNew ? (
      <Button disabled={isBusy} onClick={handleStart} size="sm">
        {isBusy ? <Spinner /> : t("startExport")}
      </Button>
    ) : (
      <Button
        disabled
        size="sm"
        title={
          formatDate
            ? t("nextAvailable", { date: formatDate(resetAt) })
            : undefined
        }
        variant="secondary"
      >
        {t("availableIn", {
          countdown: formatCountdown(remainingMs, tFormat),
        })}
      </Button>
    );
    status = <span>{idleCaption}</span>;
  }

  return (
    <SettingsSection
      action={action}
      description={tData("exportDescription")}
      id="export"
      title={tData("exportTitle")}
    >
      {status ? (
        <p
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground leading-5 [&>span+span]:before:mr-2 [&>span+span]:before:content-['·']"
        >
          {status}
        </p>
      ) : null}
    </SettingsSection>
  );
}
