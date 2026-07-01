"use client";

import { type ReactNode, useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { ExportState } from "./ExportPanel";
import { ImportExportDialog } from "./ImportExportDialog";
import { SettingRow } from "./SettingRow";

interface ImportExportSectionProps {
  exportLoading: boolean;
  exportState: ExportState | null | undefined;
  onCancelExport: (jobId: string) => Promise<void>;
  onDownloadExport: (jobId: string) => Promise<void>;
  onStartExport: () => Promise<void>;
}

export function ImportExportSection({
  exportLoading,
  exportState,
  onCancelExport,
  onDownloadExport,
  onStartExport,
}: ImportExportSectionProps) {
  const [open, setOpen] = useState(false);
  const [importActive, setImportActive] = useState(false);

  const job = exportState?.job ?? null;
  const exportActive = job?.status === "pending" || job?.status === "running";
  const canDownload = Boolean(job?.downloadAvailable);

  let badge: ReactNode = null;
  if (importActive) {
    badge = <Badge variant="secondary">Importing</Badge>;
  } else if (exportActive) {
    badge = <Badge variant="secondary">Preparing</Badge>;
  } else if (!exportLoading && canDownload) {
    badge = <Badge variant="outline">Export ready</Badge>;
  }

  return (
    <>
      <SettingRow title="Import/Export Data">
        {badge}
        <Button onClick={() => setOpen(true)} size="sm" variant="link">
          Manage
        </Button>
      </SettingRow>

      <ImportExportDialog
        exportLoading={exportLoading}
        exportState={exportState}
        onCancelExport={onCancelExport}
        onDownloadExport={onDownloadExport}
        onImportActiveChange={setImportActive}
        onOpenChange={setOpen}
        onStartExport={onStartExport}
        open={open}
      />
    </>
  );
}
