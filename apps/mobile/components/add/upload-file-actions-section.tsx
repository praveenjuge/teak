import {
  Button,
  HStack,
  Image,
  Section,
  Spacer,
  Text,
} from "@expo/ui/swift-ui";
import { disabled, foregroundStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback } from "react";
import { Alert } from "react-native";
import {
  showErrorFeedback,
  showSavingFeedback,
  showSuccessFeedback,
} from "@/lib/feedback-status";
import { useUploadFromUri } from "@/lib/hooks/use-upload-from-uri";

type UploadFileActionsSectionProps = {
  onSuccess?: () => void;
};

export function UploadFileActionsSection({
  onSuccess,
}: UploadFileActionsSectionProps) {
  const { uploadFromUri, uploadState } = useUploadFromUri({
    onError: (error) => {
      showErrorFeedback(error.message);
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        Alert.alert("Upgrade Required", error.message);
      } else {
        Alert.alert("Error", error.message);
      }
    },
    onSuccess: () => {
      showSuccessFeedback();
      onSuccess?.();
    },
  });

  const isUploading = uploadState.isUploading;

  const handleGalleryPicker = useCallback(async () => {
    if (isUploading) {
      return;
    }

    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          "Permission required",
          "Permission to access camera roll is required!"
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ["images", "videos"],
        quality: 1,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      showSavingFeedback();
      await uploadFromUri({
        additionalMetadata: {
          duration: asset.duration,
          height: asset.height,
          width: asset.width,
        },
        content:
          asset.fileName ||
          `upload_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
        fileName:
          asset.fileName ||
          `upload_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
        fileUri: asset.uri,
        mimeType: asset.type === "video" ? "video/mp4" : "image/jpeg",
      });
    } catch (error) {
      console.error(
        "Gallery picker error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert("Error", "Failed to pick from gallery");
    }
  }, [isUploading, uploadFromUri]);

  const handleCameraCapture = useCallback(async () => {
    if (isUploading) {
      return;
    }

    try {
      const permissionResult =
        await ImagePicker.requestCameraPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          "Permission required",
          "Permission to access camera is required!"
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        mediaTypes: ["images", "videos"],
        quality: 1,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      showSavingFeedback();
      await uploadFromUri({
        additionalMetadata: {
          duration: asset.duration,
          height: asset.height,
          width: asset.width,
        },
        content:
          asset.fileName ||
          `capture_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
        fileName:
          asset.fileName ||
          `capture_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
        fileUri: asset.uri,
        mimeType: asset.type === "video" ? "video/mp4" : "image/jpeg",
      });
    } catch (error) {
      console.error(
        "Camera capture error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert("Error", "Failed to open camera");
    }
  }, [isUploading, uploadFromUri]);

  const handleDocumentPicker = useCallback(async () => {
    if (isUploading) {
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ["image/*", "video/*", "audio/*"],
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      showSavingFeedback();
      await uploadFromUri({
        content: asset.name,
        fileName: asset.name,
        fileUri: asset.uri,
        mimeType: asset.mimeType || "application/octet-stream",
      });
    } catch (error) {
      console.error(
        "Document picker error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert("Error", "Failed to pick document");
    }
  }, [isUploading, uploadFromUri]);

  return (
    <Section title="Upload Files">
      <Button modifiers={[disabled(isUploading)]} onPress={handleGalleryPicker}>
        <HStack spacing={12}>
          <Image
            color="primary"
            modifiers={[frame({ height: 18, width: 18 })]}
            size={14}
            systemName="photo.on.rectangle"
          />
          <Text
            modifiers={[
              foregroundStyle({
                style: "primary",
                type: "hierarchical",
              }),
            ]}
          >
            Photos/Videos from Gallery
          </Text>
          <Spacer />
          <Image color="secondary" size={14} systemName="chevron.right" />
        </HStack>
      </Button>

      <Button modifiers={[disabled(isUploading)]} onPress={handleCameraCapture}>
        <HStack spacing={12}>
          <Image
            color="primary"
            modifiers={[frame({ height: 18, width: 18 })]}
            size={14}
            systemName="camera"
          />
          <Text
            modifiers={[
              foregroundStyle({
                style: "primary",
                type: "hierarchical",
              }),
            ]}
          >
            Open Camera
          </Text>
          <Spacer />
          <Image color="secondary" size={14} systemName="chevron.right" />
        </HStack>
      </Button>

      <Button
        modifiers={[disabled(isUploading)]}
        onPress={handleDocumentPicker}
      >
        <HStack spacing={12}>
          <Image
            color="primary"
            modifiers={[frame({ height: 18, width: 18 })]}
            size={14}
            systemName="tray.and.arrow.up"
          />
          <Text
            modifiers={[
              foregroundStyle({
                style: "primary",
                type: "hierarchical",
              }),
            ]}
          >
            Upload Files
          </Text>
          <Spacer />
          <Image color="secondary" size={14} systemName="chevron.right" />
        </HStack>
      </Button>
    </Section>
  );
}
