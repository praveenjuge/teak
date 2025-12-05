import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Text as RNText,
  ScrollView,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { router, Stack } from "expo-router";
import { useCreateCard } from "../../../lib/hooks/useCardOperations";
import { useFileUpload } from "../../../lib/hooks/useFileUpload";
import { IconSymbol } from "../../../components/ui/IconSymbol";
import { colors } from "../../../constants/colors";
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
  Text as SwiftText,
  TextField,
  VStack,
  type TextFieldRef,
} from "@expo/ui/swift-ui";
import { border, frame, padding } from "@expo/ui/swift-ui/modifiers";

export default function AddScreen() {
  const [content, setContent] = useState("");
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [isTextSheetOpen, setIsTextSheetOpen] = useState(false);
  const [textFieldKey, setTextFieldKey] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
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

    if (!feedbackVisibleRef.current) {
      feedbackVisibleRef.current = true;
      router.push("/(feedback)");
    }
  }, []);

  const showSavedFeedback = useCallback(
    (message = "Saved Successfully!") => {
      showFeedback({
        title: "Save to Teak",
        message,
        iconName: "checkmark.circle.fill",
        dismissAfterMs: 1500,
      });
    },
    [showFeedback]
  );

  const showErrorFeedback = useCallback(
    (message: string) => {
      showFeedback({
        title: "Unable to Save",
        message,
        iconName: "exclamationmark.triangle.fill",
        accentColor: "#ff3b30",
        dismissAfterMs: 4000,
      });
    },
    [showFeedback]
  );
  const showSavingFeedback = useCallback(() => {
    showFeedback({
      title: "Save to Teak",
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
      const response = await fetch(fileUri);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: mimeType });

      await uploadFile(file, {
        content: fileName,
        additionalMetadata,
      });
    } catch (error) {
      console.error("Failed to upload file:", error);
      showErrorFeedback("Failed to upload file. Please try again.");
      Alert.alert("Error", "Failed to upload file. Please try again.");
    }
  };

  async function startRecording() {
    if (uploadState.isUploading || isSavingCard) {
      return;
    }

    try {
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
      console.error("Failed to start recording", err);
      Alert.alert("Error", "Failed to start recording.");
    }
  }

  async function stopRecording() {
    if (!audioRecorder.isRecording) {
      return;
    }

    setIsRecording(false);
    await audioRecorder.stop();

    const uri = audioRecorder.uri;
    if (uri) {
      await handleFileUpload(uri, `recording-${Date.now()}.m4a`, "audio/m4a");
    }
    setRecordingDuration(0);
  }

  const handleGalleryPicker = async () => {
    if (uploadState.isUploading || isSavingCard) {
      return;
    }

    try {
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
      console.error("Gallery picker error:", error);
      Alert.alert("Error", "Failed to pick from gallery");
    }
  };

  const handleCameraCapture = async () => {
    if (uploadState.isUploading || isSavingCard) {
      return;
    }

    try {
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
      console.error("Camera capture error:", error);
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
      console.error("Document picker error:", error);
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
      await createCard({ content: trimmedContent });

      setContent("");
      textFieldRef.current?.setText("");
      setTextFieldKey((value) => value + 1);
      setIsTextSheetOpen(false);
      showSavedFeedback();
    } catch (error) {
      console.error("Failed to save card:", error);
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

  if (isRecording) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.background,
        }}
      >
        <RNText style={{ color: colors.label, marginBottom: 40 }}>
          Recording...
        </RNText>
        <TouchableOpacity
          onPress={stopRecording}
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: "red",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 40,
          }}
        >
          <IconSymbol color="white" name="stop.fill" />
        </TouchableOpacity>
        <RNText
          style={{
            color: colors.secondaryLabel,
          }}
        >
          {new Date(recordingDuration * 1000).toISOString().substring(14, 19)}
        </RNText>
      </View>
    );
  }

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
            <Section>
              <Button
                onPress={() => setIsTextSheetOpen(true)}
                disabled={isSavingCard || uploadState.isUploading}
              >
                <HStack spacing={8}>
                  <Image
                    systemName="textformat"
                    color="primary"
                    size={18}
                    modifiers={[frame({ width: 28, height: 28 })]}
                  />
                  <SwiftText color="primary">Text or URL</SwiftText>
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
                disabled={uploadState.isUploading || isSavingCard}
              >
                <HStack spacing={8}>
                  <Image
                    systemName="mic.fill"
                    color="primary"
                    size={18}
                    modifiers={[frame({ width: 28, height: 28 })]}
                  />
                  <SwiftText color="primary">Record Audio</SwiftText>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    size={14}
                    color="secondary"
                  />
                </HStack>
              </Button>
            </Section>
            <Section>
              <Button
                onPress={handleGalleryPicker}
                disabled={uploadState.isUploading || isSavingCard}
              >
                <HStack spacing={8}>
                  <Image
                    systemName="photo.on.rectangle"
                    color="primary"
                    size={16}
                    modifiers={[frame({ width: 28, height: 28 })]}
                  />
                  <SwiftText color="primary">
                    Photos/Videos from Gallery
                  </SwiftText>
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
                <HStack spacing={8}>
                  <Image
                    systemName="camera"
                    color="primary"
                    size={18}
                    modifiers={[frame({ width: 28, height: 28 })]}
                  />
                  <SwiftText color="primary">Open Camera</SwiftText>
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
                <HStack spacing={8}>
                  <Image
                    systemName="tray.and.arrow.up"
                    color="primary"
                    size={16}
                    modifiers={[frame({ width: 28, height: 28 })]}
                  />
                  <SwiftText color="primary">Upload Files</SwiftText>
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
            <VStack
              spacing={12}
              modifiers={[padding({ horizontal: 16, vertical: 16 })]}
            >
              <TextField
                key={textFieldKey}
                ref={textFieldRef}
                defaultValue={content}
                placeholder="Enter your bookmark, URL, or note"
                onChangeText={setContent}
                multiline
                allowNewlines
                modifiers={[
                  border({ color: "#ccc", width: 1 }),
                  padding({ all: 8 }),
                ]}
              />
              <Button
                onPress={handleSaveText}
                disabled={isSavingCard || uploadState.isUploading}
                variant="glass"
              >
                <SwiftText color="primary">
                  {isSavingCard || uploadState.isUploading
                    ? "Saving..."
                    : "Save"}
                </SwiftText>
              </Button>
            </VStack>
          </BottomSheet>
        </Host>
      </ScrollView>
    </>
  );
}
