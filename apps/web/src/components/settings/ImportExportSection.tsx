"use client";

import { useTranslations } from "@teak/i18n/react";
import { useEffect, useState } from "react";
import type { SettingsDialogTab } from "../../lib/commandPalette";
import { Button } from "../ui/button";
import type { ExportState } from "./ExportPanel";
import { ImportExportDialog } from "./ImportExportDialog";
import { SettingRow } from "./SettingRow";

export interface ImportExportOpenRequest {
  id: number;
  tab: SettingsDialogTab;
}

interface ImportExportSectionProps {
  exportLoading: boolean;
  exportState: ExportState | null | undefined;
  onCancelExport: (jobId: string) => Promise<void>;
  onDownloadExport: (jobId: string) => Promise<void>;
  onStartExport: () => Promise<void>;
  openRequest?: ImportExportOpenRequest | null;
}

export function ImportExportSection({
  exportLoading,
  exportState,
  onCancelExport,
  onDownloadExport,
  onStartExport,
  openRequest,
}: ImportExportSectionProps) {
  const t = useTranslations("settings.importExport");
  const tRows = useTranslations("settings.rows");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsDialogTab>("import");
  const [, setImportActive] = useState(false);

  useEffect(() => {
    if (openRequest) {
      setTab(openRequest.tab);
      setOpen(true);
    }
  }, [openRequest]);

  return (
    <>
      <SettingRow title={tRows("importExport")}>
        <Button
          aria-label={t("manageLabel")}
          onClick={() => {
            setTab("import");
            setOpen(true);
          }}
          size="sm"
          variant="link"
        >
          {t("manage")}
        </Button>
      </SettingRow>

      <ImportExportDialog
        defaultTab={tab}
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
