"use client";

import { useTranslations } from "@teak/i18n/react";
import { ArrowDownUp } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ExportPanel, type ExportState } from "./ExportPanel";
import { ImportPanel } from "./ImportPanel";
import {
  SettingsDialog,
  settingsTabsClassName,
  settingsTabsContentClassName,
  settingsTabsListClassName,
  settingsTabsTriggerClassName,
} from "./SettingsDialog";

interface ImportExportDialogProps {
  defaultTab?: "import" | "export";
  exportLoading: boolean;
  exportState: ExportState | null | undefined;
  onCancelExport: (jobId: string) => Promise<void>;
  onDownloadExport: (jobId: string) => Promise<void>;
  onImportActiveChange?: (active: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onStartExport: () => Promise<void>;
  open: boolean;
}

export function ImportExportDialog({
  defaultTab = "import",
  exportLoading,
  exportState,
  onCancelExport,
  onDownloadExport,
  onImportActiveChange,
  onOpenChange,
  onStartExport,
  open,
}: ImportExportDialogProps) {
  const t = useTranslations("settings.importExport");
  return (
    <SettingsDialog
      className="sm:h-[min(88dvh,36rem)] sm:max-w-lg"
      description={t("description")}
      icon={ArrowDownUp}
      onOpenChange={onOpenChange}
      open={open}
      title={t("title")}
    >
      <Tabs className={settingsTabsClassName} defaultValue={defaultTab}>
        <TabsList className={settingsTabsListClassName}>
          <TabsTrigger className={settingsTabsTriggerClassName} value="import">
            {t("importTab")}
          </TabsTrigger>
          <TabsTrigger className={settingsTabsTriggerClassName} value="export">
            {t("exportTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent className={settingsTabsContentClassName} value="import">
          <ImportPanel onActiveChange={onImportActiveChange} />
        </TabsContent>
        <TabsContent className={settingsTabsContentClassName} value="export">
          <ExportPanel
            exportState={exportState}
            isLoading={exportLoading}
            onCancelExport={onCancelExport}
            onDownloadExport={onDownloadExport}
            onStartExport={onStartExport}
          />
        </TabsContent>
      </Tabs>
    </SettingsDialog>
  );
}
