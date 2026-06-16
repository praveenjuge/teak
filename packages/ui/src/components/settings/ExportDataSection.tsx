import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import {
  ExportDataDialog,
  type ExportState,
} from "./ExportDataDialog";
import { SettingRow } from "./SettingRow";

interface ExportDataSectionProps {
  exportState: ExportState | null | undefined;
  isLoading: boolean;
  onCancelExport: (jobId: string) => Promise<void>;
  onDownloadExport: (jobId: string) => Promise<void>;
  onStartExport: () => Promise<void>;
}

export function ExportDataSection({
  exportState,
  isLoading,
  onCancelExport,
  onDownloadExport,
  onStartExport,
}: ExportDataSectionProps) {
  const [open, setOpen] = useState(false);

  const job = exportState?.job ?? null;
  const isActive = job?.status === "pending" || job?.status === "running";
  const canDownload = Boolean(job?.downloadAvailable);

  const badge = isActive ? (
    <Badge variant="secondary">Preparing</Badge>
  ) : canDownload ? (
    <Badge variant="outline">Ready</Badge>
  ) : null;

  return (
    <>
      <SettingRow title="Export Data">
        {isLoading ? (
          <Button disabled size="sm" variant="ghost">
            <Spinner />
          </Button>
        ) : (
          <>
            {badge}
            <Button onClick={() => setOpen(true)} size="sm" variant="link">
              Manage
            </Button>
          </>
        )}
      </SettingRow>

      <ExportDataDialog
        exportState={exportState}
        isLoading={isLoading}
        onCancelExport={onCancelExport}
        onDownloadExport={onDownloadExport}
        onOpenChange={setOpen}
        onStartExport={onStartExport}
        open={open}
      />
    </>
  );
}
