import {
  useFileUpload,
  useGlobalDragDrop as useSharedGlobalDragDrop,
} from "@teak/ui/hooks";
import { useCallback } from "react";
import { buildWebUrl } from "@/lib/web-urls";

export function useGlobalDragDrop() {
  const { uploadMultipleFiles } = useFileUpload();

  const handleUpgrade = useCallback(() => {
    void window.teakDesktop.shell.openExternal(buildWebUrl("/settings"));
  }, []);

  return useSharedGlobalDragDrop({
    uploadMultipleFiles,
    onUpgrade: handleUpgrade,
  });
}
