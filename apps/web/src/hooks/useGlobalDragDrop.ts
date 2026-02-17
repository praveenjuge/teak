import { useGlobalDragDrop as useSharedGlobalDragDrop } from "@teak/ui/hooks";
import { useFileUpload } from "./useFileUpload";

export function useGlobalDragDrop() {
  const { uploadMultipleFiles } = useFileUpload();

  return useSharedGlobalDragDrop({
    uploadMultipleFiles,
    upgradeUrl: "/settings",
  });
}
