"use client";

import { useState } from "react";
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
  const [, setImportActive] = useState(false);

  return (
    <>
      <SettingRow title="Import/Export Data">
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
