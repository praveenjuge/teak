import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, useWindowDimensions } from "react-native";
import { CARD_ERROR_CODES, resolveTextCardInput } from "@teak/convex/shared";
import { Stack } from "expo-router";
import { useCreateCard } from "../../../lib/hooks/useCardOperations";
import { useFileUpload } from "../../../lib/hooks/useFileUpload";
import {
  setFeedbackStatus,
  subscribeFeedbackStatus,
  type FeedbackStatusPayload,
} from "../../../lib/feedbackBridge";
import {
  BottomSheet,
  Button,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  TextField,
  type TextFieldRef,
} from "@expo/ui/swift-ui";
import { frame } from "@expo/ui/swift-ui/modifiers";
import { stopAudioRecording } from "../../../lib/recording";

export default function AddScreen() {
  const [content, setContent] = useState("");
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [isTextSheetOpen, setIsTextSheetOpen] = useState(false);
  const [textFieldKey, setTextFieldKey] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const textFieldRef = useRef<TextFieldRef>(null);
  const createCard = useCreateCard();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const feedbackVisibleRef = useRef(false);
  const { width } = useWindowDimensions();

  useEffect(() => {
    const unsubscribe = subscribeFeedbackStatus((payload) => {
      if (!payload) {
        feedbackVisibleRef.current = false;
      }
    });
    return unsubscribe;
  }, []);

  const showFeedback = useCallback((payload: FeedbackStatusPayload) => {
    setFeedbackStatus(payload);

    feedbackVisibleRef.current = true;
  }, []);

  const showSavedFeedback = useCallback(
    (message = "Saved Successfully!") => {
      showFeedback({
        message,
        iconName: "checkmark.circle.fill",
        dismissAfterMs: 1000,
      });
    },
    [showFeedback]
  );

  const showErrorFeedback = useCallback(
    (message: string) => {
      showFeedback({
        message,
        iconName: "exclamationmark.triangle.fill",
        dismissAfterMs: 4000,
      });
    },
    [showFeedback]
  );
  const showSavingFeedback = useCallback(() => {
    showFeedback({
      message: "Saving...",
      iconName: "hourglass",
      dismissAfterMs: -1,
    });
  }, [showFeedback]);

  // Use shared file upload hook
  const { uploadFile, state: uploadState } = useFileUpload({
    onSuccess: () => {
      showSavedFeedback();
    },
    onError: (error) => {
      showErrorFeedback(error.message);
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        Alert.alert("Upgrade Required", error.message);
      } else {
        Alert.alert("Error", error.message);
      }
    },
  });

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRecording) {
      interval = setInterval(() => {
        if (audioRecorder.isRecording) {
          setRecordingDuration(audioRecorder.currentTime ?? 0);
        }
      }, 1000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isRecording, audioRecorder]);

  const handleFileUpload = async (
    fileUri: string,
    fileName: string,
    mimeType: string,
    additionalMetadata?: Record<string, unknown>
  ) => {
    try {
      showSavingFeedback();
      // Convert React Native file URI to Blob for the shared upload hook
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(fileUri, { signal: controller.signal });
      clearTimeout(timeoutId);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: mimeType });

      await uploadFile(file, {
        content: fileName,
        additionalMetadata,
      });
    } catch (error) {
      console.error("Failed to upload file:", error instanceof Error ? error.message : error);
      showErrorFeedback("Failed to upload file. Please try again.");
      Alert.alert("Error", "Failed to upload file. Please try again.");
    }
  };

  async function startRecording() {
    if (uploadState.isUploading || isSavingCard || isStoppingRecording) {
      return;
    }

    try {
      // Check if we need to show pre-permission alert (only for first-time requests)
      const existingStatus = await getRecordingPermissionsAsync();
      if (existingStatus.status === "undetermined") {
        // Show pre-permission alert (Apple HIG compliance: single "Continue" button, no cancel)
        await new Promise<void>((resolve) => {
          Alert.alert(
            "Microphone Access Required",
            "Teak uses the microphone to record voice notes and audio reminders. These recordings are saved directly to your inspiration collection so you can capture ideas on the go.",
            [{ text: "Continue", onPress: () => resolve() }]
          );
        });
      }

      // Request audio recording permissions
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert(
          "Permission Required",
          "Audio recording permission is required to record audio."
        );
        return;
      }

      // Set audio mode to allow recording on iOS
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setRecordingDuration(0);
      setIsTextSheetOpen(false);
    } catch (err) {
      console.error("Failed to start recording:", err instanceof Error ? err.message : err);
      Alert.alert("Error", "Failed to start recording.");
    }
  }

  async function stopRecording() {
    if (!audioRecorder.isRecording || isStoppingRecording) {
      return;
    }

    await stopAudioRecording({
      audioRecorder,
      setIsRecording,
      setIsStoppingRecording,
      setRecordingDuration,
      handleFileUpload,
      onError: (error) => {
        console.error("Failed to stop recording:", error instanceof Error ? error.message : error);
        showErrorFeedback("Failed to save recording. Please try again.");
        Alert.alert("Error", "Failed to save recording. Please try again.");
      },
    });
  }

  const handleGalleryPicker = async () => {
    if (uploadState.isUploading || isSavingCard) {
      return;
    }

    try {
      // Check if we need to show pre-permission alert (only for first-time requests)
      const existingStatus = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (existingStatus.status === "undetermined") {
        // Show pre-permission alert (Apple HIG compliance: single "Continue" button, no cancel)
        await new Promise<void>((resolve) => {
          Alert.alert(
            "Photo Library Access Required",
            "Teak needs access to your photo library so you can select existing photos and videos to save as inspirations. This lets you add content you've already captured to your collection.",
            [{ text: "Continue", onPress: () => resolve() }]
          );
        });
      }

      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permissionResult.granted === false) {
        Alert.alert(
          "Permission required",
          "Permission to access camera roll is required!"
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await handleFileUpload(
          asset.uri,
          asset.fileName ||
            `upload_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
          asset.type === "video" ? "video/mp4" : "image/jpeg",
          {
            width: asset.width,
            height: asset.height,
            duration: asset.duration,
          }
        );
      }
    } catch (error) {
      console.error("Gallery picker error:", error instanceof Error ? error.message : error);
      Alert.alert("Error", "Failed to pick from gallery");
    }
  };

  const handleCameraCapture = async () => {
    if (uploadState.isUploading || isSavingCard) {
      return;
    }

    try {
      // Check if we need to show pre-permission alert (only for first-time requests)
      const existingStatus = await ImagePicker.getCameraPermissionsAsync();
      if (existingStatus.status === "undetermined") {
        // Show pre-permission alert (Apple HIG compliance: single "Continue" button, no cancel)
        await new Promise<void>((resolve) => {
          Alert.alert(
            "Camera Access Required",
            "Teak uses the camera to let you capture new photos and videos directly within the app. This makes it easy to add fresh inspirations to your collection.",
            [{ text: "Continue", onPress: () => resolve() }]
          );
        });
      }

      const permissionResult =
        await ImagePicker.requestCameraPermissionsAsync();

      if (permissionResult.granted === false) {
        Alert.alert(
          "Permission required",
          "Permission to access camera is required!"
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images", "videos"],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await handleFileUpload(
          asset.uri,
          asset.fileName ||
            `capture_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
          asset.type === "video" ? "video/mp4" : "image/jpeg",
          {
            width: asset.width,
            height: asset.height,
            duration: asset.duration,
          }
        );
      }
    } catch (error) {
      console.error("Camera capture error:", error instanceof Error ? error.message : error);
      Alert.alert("Error", "Failed to open camera");
    }
  };

  const handleDocumentPicker = async () => {
    if (uploadState.isUploading || isSavingCard) {
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "video/*", "audio/*"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await handleFileUpload(
          asset.uri,
          asset.name,
          asset.mimeType || "application/octet-stream"
        );
      }
    } catch (error) {
      console.error("Document picker error:", error instanceof Error ? error.message : error);
      Alert.alert("Error", "Failed to pick document");
    }
  };

  const handleSaveText = useCallback(async () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      Alert.alert("Error", "Please enter some content");
      return;
    }

    if (uploadState.isUploading || isSavingCard) {
      return;
    }

    setIsSavingCard(true);
    showSavingFeedback();

    try {
      const resolved = resolveTextCardInput({ content: trimmedContent });
      await createCard({
        content: resolved.content,
        type: resolved.type === "link" ? resolved.type : undefined,
        url: resolved.url,
      });

      setContent("");
      textFieldRef.current?.setText("");
      setTextFieldKey((value) => value + 1);
      setIsTextSheetOpen(false);
      showSavedFeedback();
    } catch (error) {
      console.error("Failed to save card:", error instanceof Error ? error.message : error);
      showErrorFeedback("Failed to save card. Please try again.");
      Alert.alert("Error", "Failed to save card. Please try again.");
    } finally {
      setIsSavingCard(false);
    }
  }, [
    content,
    createCard,
    isSavingCard,
    showSavedFeedback,
    showSavingFeedback,
    showErrorFeedback,
    uploadState.isUploading,
  ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Add",
        }}
      />
      <ScrollView>
        <Host matchContents useViewportSizeMeasurement>
          <List scrollEnabled={false}>
            <Section title="Add Content">
              <Button
                onPress={() => setIsTextSheetOpen(true)}
                disabled={isSavingCard || uploadState.isUploading}
              >
                <HStack spacing={12}>
                  <Image
                    systemName="textformat"
                    color="primary"
                    size={14}
                    modifiers={[frame({ width: 18, height: 18 })]}
                  />
                  <Text color="primary">Text or URL</Text>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    size={14}
                    color="secondary"
                  />
                </HStack>
              </Button>
              <Button
                onPress={startRecording}
                disabled={
                  uploadState.isUploading || isSavingCard || isStoppingRecording
                }
              >
                <HStack spacing={12}>
                  <Image
                    systemName="mic.fill"
                    color="primary"
                    size={14}
                    modifiers={[frame({ width: 18, height: 18 })]}
                  />
                  <Text color="primary">Record Audio</Text>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    size={14}
                    color="secondary"
                  />
                </HStack>
              </Button>
            </Section>
            <Section title="Upload Files">
              <Button
                onPress={handleGalleryPicker}
                disabled={uploadState.isUploading || isSavingCard}
              >
                <HStack spacing={12}>
                  <Image
                    systemName="photo.on.rectangle"
                    color="primary"
                    size={14}
                    modifiers={[frame({ width: 18, height: 18 })]}
                  />
                  <Text color="primary">Photos/Videos from Gallery</Text>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    size={14}
                    color="secondary"
                  />
                </HStack>
              </Button>
              <Button
                onPress={handleCameraCapture}
                disabled={uploadState.isUploading || isSavingCard}
              >
                <HStack spacing={12}>
                  <Image
                    systemName="camera"
                    color="primary"
                    size={14}
                    modifiers={[frame({ width: 18, height: 18 })]}
                  />
                  <Text color="primary">Open Camera</Text>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    size={14}
                    color="secondary"
                  />
                </HStack>
              </Button>
              <Button
                onPress={handleDocumentPicker}
                disabled={uploadState.isUploading || isSavingCard}
              >
                <HStack spacing={12}>
                  <Image
                    systemName="tray.and.arrow.up"
                    color="primary"
                    size={14}
                    modifiers={[frame({ width: 18, height: 18 })]}
                  />
                  <Text color="primary">Upload Files</Text>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    size={14}
                    color="secondary"
                  />
                </HStack>
              </Button>
            </Section>
          </List>
        </Host>
        <Host
          style={{ position: "absolute", width, top: 0, left: 0 }}
          useViewportSizeMeasurement
        >
          <BottomSheet
            isOpened={isTextSheetOpen}
            onIsOpenedChange={(open) => {
              setIsTextSheetOpen(open);
              if (!open) {
                setContent("");
                textFieldRef.current?.setText("");
                setTextFieldKey((value) => value + 1);
              }
            }}
            presentationDetents={["medium", "large"]}
            presentationDragIndicator="visible"
            interactiveDismissDisabled={isSavingCard}
          >
            <List>
              <TextField
                key={textFieldKey}
                ref={textFieldRef}
                defaultValue={content}
                placeholder="Enter your bookmark, URL, or note"
                onChangeText={setContent}
                multiline
                numberOfLines={10}
                allowNewlines
              />
              <Button
                variant="bordered"
                controlSize="large"
                onPress={handleSaveText}
                disabled={isSavingCard || uploadState.isUploading}
              >
                <HStack spacing={10} alignment="center">
                  <Spacer />
                  <Text color="primary">
                    {isSavingCard || uploadState.isUploading
                      ? "Saving..."
                      : "Save"}
                  </Text>
                  <Spacer />
                </HStack>
              </Button>
            </List>
          </BottomSheet>
        </Host>
        <Host
          style={{ position: "absolute", width, top: 0, left: 0 }}
          useViewportSizeMeasurement
        >
          <BottomSheet
            isOpened={isRecording}
            onIsOpenedChange={(open) => {
              if (!open && isRecording) {
                stopRecording();
              }
            }}
            presentationDetents={["medium"]}
            presentationDragIndicator="visible"
            interactiveDismissDisabled
          >
            <List>
              <HStack spacing={8} alignment="center">
                <Text color="primary">
                  {isStoppingRecording ? "Stopping..." : "Recording..."}
                </Text>
                <Spacer />
                <Text color="secondary">
                  {new Date(recordingDuration * 1000)
                    .toISOString()
                    .substring(14, 19)}
                </Text>
              </HStack>
              <Button
                onPress={stopRecording}
                disabled={isStoppingRecording}
                role="destructive"
                variant="bordered"
                controlSize="large"
              >
                <HStack spacing={8} alignment="center">
                  <Spacer />
                  <Image systemName="stop.fill" color="red" size={18} />
                  <Text color="red" design="rounded">
                    {isStoppingRecording ? "Stopping" : "Stop Recording"}
                  </Text>
                  <Spacer />
                </HStack>
              </Button>
            </List>
          </BottomSheet>
        </Host>
      </ScrollView>
    </>
  );
}
