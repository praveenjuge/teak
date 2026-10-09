"use client";

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
  exportLoading,
  exportState,
  onCancelExport,
  onDownloadExport,
  onImportActiveChange,
  onOpenChange,
  onStartExport,
  open,
}: ImportExportDialogProps) {
  return (
    <SettingsDialog
      className="sm:h-[min(88dvh,36rem)] sm:max-w-lg"
      description="Bring cards in from other tools, or take a full copy with you."
      icon={ArrowDownUp}
      onOpenChange={onOpenChange}
      open={open}
      title="Manage data"
    >
      <Tabs className={settingsTabsClassName} defaultValue="import">
        <TabsList className={settingsTabsListClassName}>
          <TabsTrigger className={settingsTabsTriggerClassName} value="import">
            Import
          </TabsTrigger>
          <TabsTrigger className={settingsTabsTriggerClassName} value="export">
            Export
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
