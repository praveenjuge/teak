import { CARD_ERROR_CODES, MAX_FILES_PER_UPLOAD } from "@teak/convex/shared";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback } from "react";
import { Alert } from "react-native";
import { AddActionRow } from "@/components/add/AddActionRow";
import { normalizeNativeFileAsset } from "@/lib/files";
import {
  type UploadFromUriParams,
  useUploadFromUri,
} from "@/lib/hooks/use-upload-from-uri";

interface UploadFileActionsSectionProps {
  onSuccess?: () => void;
}

export function UploadFileActionsSection({
  onSuccess,
}: UploadFileActionsSectionProps) {
  const { uploadFromUri, uploadState } = useUploadFromUri();

  const isUploading = uploadState.isUploading;

  // Uploads up to five files one at a time, like dropping them on the web,
  // and reports once at the end. The card limit stops the rest.
  const uploadAll = useCallback(
    async (files: UploadFromUriParams[]) => {
      let saved = 0;
      let lastError: { code?: string; message: string } | null = null;
      for (const file of files) {
        const result = await uploadFromUri(file);
        if (result.success) {
          saved += 1;
          continue;
        }
        lastError = {
          code:
            typeof result.errorCode === "string" ? result.errorCode : undefined,
          message: result.error || "File upload failed.",
        };
        if (lastError.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          break;
        }
      }
      if (lastError?.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        Alert.alert("Card limit reached", lastError.message);
      } else if (lastError) {
        Alert.alert(
          saved > 0 ? `Saved ${saved} of ${files.length}` : "Upload failed",
          lastError.message
        );
      }
      if (saved > 0) {
        onSuccess?.();
      }
    },
    [onSuccess, uploadFromUri]
  );

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
        allowsMultipleSelection: true,
        mediaTypes: ["images", "videos"],
        orderedSelection: true,
        quality: 1,
        selectionLimit: MAX_FILES_PER_UPLOAD,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      await uploadAll(
        result.assets.map((asset, index) => {
          const fallbackName = `upload_${Date.now()}_${index + 1}.${asset.type === "video" ? "mp4" : "jpg"}`;
          return {
            additionalMetadata: {
              duration: asset.duration,
              height: asset.height,
              width: asset.width,
            },
            content: asset.fileName || fallbackName,
            fileName: asset.fileName || fallbackName,
            fileSize: asset.fileSize ?? null,
            fileUri: asset.uri,
            mimeType:
              asset.mimeType ??
              (asset.type === "video" ? "video/mp4" : "image/jpeg"),
          };
        })
      );
    } catch (error) {
      console.error(
        "Gallery picker error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert("Error", "Failed to pick from gallery");
    }
  }, [isUploading, uploadAll]);

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
      await uploadAll([
        {
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
        },
      ]);
    } catch (error) {
      console.error(
        "Camera capture error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert("Error", "Failed to open camera");
    }
  }, [isUploading, uploadAll]);

  const handleDocumentPicker = useCallback(async () => {
    if (isUploading) {
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: "*/*",
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const assets = result.assets.slice(0, MAX_FILES_PER_UPLOAD);
      const files = assets
        .map((asset) => normalizeNativeFileAsset(asset))
        .filter((file) => file !== null)
        .map((file) => ({ content: file.fileName, ...file }));
      if (files.length < assets.length) {
        Alert.alert(
          files.length === 0 ? "Unsupported File" : "Some files were skipped",
          files.length === 0
            ? "This file format cannot be uploaded."
            : "Some file formats cannot be uploaded."
        );
      }
      if (result.assets.length > MAX_FILES_PER_UPLOAD) {
        Alert.alert(
          "Too many files",
          `Teak saves up to ${MAX_FILES_PER_UPLOAD} files at a time. The first ${MAX_FILES_PER_UPLOAD} will be saved.`
        );
      }
      if (files.length > 0) {
        await uploadAll(files);
      }
    } catch (error) {
      console.error(
        "Document picker error:",
        error instanceof Error ? error.message : error
      );
      Alert.alert("Error", "Failed to pick document");
    }
  }, [isUploading, uploadAll]);

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
