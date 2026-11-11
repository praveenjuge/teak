"use client";

import type { Id } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { ExportPanel, type ExportState } from "./ExportPanel";
import { ImportPanel } from "./ImportPanel";
import { SettingsPageIntro, SettingsStack } from "./SettingsSection";

interface DataSettingsProps {
  exportLoading: boolean;
  exportState: ExportState | null | undefined;
  onCancelExport: (jobId: Id<"exportJobs">) => Promise<void>;
  onDownloadExport: (jobId: Id<"exportJobs">) => Promise<void>;
  onStartExport: () => Promise<void>;
}

export function DataSettings({
  exportLoading,
  exportState,
  onCancelExport,
  onDownloadExport,
  onStartExport,
}: DataSettingsProps) {
  const tPages = useTranslations("settings.pages");
  return (
    <>
      <SettingsPageIntro title={tPages("data.title")} />
      <SettingsStack>
        <ImportPanel />
        <ExportPanel
          exportState={exportState}
          isLoading={exportLoading}
          onCancelExport={onCancelExport}
          onDownloadExport={onDownloadExport}
          onStartExport={onStartExport}
        />
      </SettingsStack>
    </>
  );
}
