import { Host, List } from "@expo/ui/swift-ui";
import { router } from "expo-router";
import { UploadFileActionsSection } from "@/components/add/upload-file-actions-section";

export default function AddUploadScreen() {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <List>
        <UploadFileActionsSection onSuccess={() => router.back()} />
      </List>
    </Host>
  );
}
