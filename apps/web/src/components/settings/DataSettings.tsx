"use client";

import { useTranslations } from "@teak/i18n/react";
import { ExportPanel, type ExportState } from "./ExportPanel";
import { ImportPanel } from "./ImportPanel";
import {
  SettingsPageIntro,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";

interface DataSettingsProps {
  exportLoading: boolean;
  exportState: ExportState | null | undefined;
  onCancelExport: (jobId: string) => Promise<void>;
  onDownloadExport: (jobId: string) => Promise<void>;
  onStartExport: () => Promise<void>;
}

export function DataSettings({
  exportLoading,
  exportState,
  onCancelExport,
  onDownloadExport,
  onStartExport,
}: DataSettingsProps) {
  const t = useTranslations("settings.data");
  const tPages = useTranslations("settings.pages");
  return (
    <>
      <SettingsPageIntro
        description={tPages("data.description")}
        title={tPages("data.title")}
      />
      <SettingsStack>
        <SettingsSection
          description={t("importDescription")}
          id="import"
          title={t("importTitle")}
        >
          <ImportPanel />
        </SettingsSection>
        <SettingsSection id="export" title={t("exportTitle")}>
          <ExportPanel
            exportState={exportState}
            isLoading={exportLoading}
            onCancelExport={onCancelExport}
            onDownloadExport={onDownloadExport}
            onStartExport={onStartExport}
          />
        </SettingsSection>
      </SettingsStack>
    </>
  );
}
