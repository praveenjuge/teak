import { CARD_ERROR_CODES } from "@teak/convex/shared";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback } from "react";
import { Alert } from "react-native";
import { AddActionRow } from "@/components/add/AddActionRow";
import { normalizeNativeFileAsset } from "@/lib/files";
import { useUploadFromUri } from "@/lib/hooks/use-upload-from-uri";

interface UploadFileActionsSectionProps {
  onSuccess?: () => void;
}

export function UploadFileActionsSection({
  onSuccess,
}: UploadFileActionsSectionProps) {
  const { uploadFromUri, uploadState } = useUploadFromUri({
    onError: (error) => {
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        Alert.alert("Upgrade Required", error.message);
      } else {
        Alert.alert("Error", error.message);
      }
    },
    onSuccess: () => {
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
        fileSize: asset.fileSize ?? null,
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
        fileSize: asset.fileSize ?? null,
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
        type: "*/*",
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      const normalized = normalizeNativeFileAsset(asset);
      if (!normalized) {
        Alert.alert("Unsupported File", "This file format cannot be uploaded.");
        return;
      }
      await uploadFromUri({
        content: normalized.fileName,
        ...normalized,
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
    <>
      <AddActionRow
        color="systemGreen"
        disabled={isUploading}
        label="Photos & Videos"
        onPress={handleGalleryPicker}
        systemImage="photo.on.rectangle"
      />
      <AddActionRow
        color="systemGray"
        disabled={isUploading}
        label="Camera"
        onPress={handleCameraCapture}
        systemImage="camera.fill"
      />
      <AddActionRow
        color="systemIndigo"
        disabled={isUploading}
        label="Files"
        onPress={handleDocumentPicker}
        systemImage="folder.fill"
      />
    </>
  );
}
