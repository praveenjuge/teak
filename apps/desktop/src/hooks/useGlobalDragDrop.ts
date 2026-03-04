import { openUrl } from "@tauri-apps/plugin-opener";
import { useGlobalDragDrop as useSharedGlobalDragDrop } from "@teak/ui/hooks";
import { useCallback } from "react";
import { buildWebUrl } from "@/lib/web-urls";
import { useFileUpload } from "./useFileUpload";

export function useGlobalDragDrop() {
  const { uploadMultipleFiles } = useFileUpload();

  const handleUpgrade = useCallback(() => {
    void openUrl(buildWebUrl("/settings"));
  }, []);

  return useSharedGlobalDragDrop({
    uploadMultipleFiles,
    onUpgrade: handleUpgrade,
  });
}
