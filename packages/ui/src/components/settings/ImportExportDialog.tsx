"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ExportPanel, type ExportState } from "./ExportPanel";
import { ImportPanel } from "./ImportPanel";

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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[85vh] min-w-0 gap-4 overflow-x-hidden overflow-y-auto p-4 sm:max-w-lg">
        <DialogHeader className="gap-1">
          <DialogTitle>Manage Data</DialogTitle>
          <DialogDescription>
            Import or export your Teak data.
          </DialogDescription>
        </DialogHeader>

        <Tabs className="min-w-0" defaultValue="import">
          <TabsList className="w-full">
            <TabsTrigger value="import">Import</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          <TabsContent className="min-w-0 pt-4" value="import">
            <ImportPanel onActiveChange={onImportActiveChange} />
          </TabsContent>
          <TabsContent className="min-w-0 pt-4" value="export">
            <ExportPanel
              exportState={exportState}
              isLoading={exportLoading}
              onCancelExport={onCancelExport}
              onDownloadExport={onDownloadExport}
              onStartExport={onStartExport}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
