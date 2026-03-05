import {
  useFileUpload,
  useGlobalDragDrop as useSharedGlobalDragDrop,
} from "@teak/ui/hooks";

export function useGlobalDragDrop() {
  const { uploadMultipleFiles } = useFileUpload();

  return useSharedGlobalDragDrop({
    uploadMultipleFiles,
    upgradeUrl: "/settings",
  });
}
