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
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { router } from "expo-router";
import { useCreateCard } from "../../lib/hooks/useCardOperations";
import { useFileUpload } from "../../lib/hooks/useFileUpload";
import { IconSymbol } from "../../components/ui/IconSymbol";
import { borderWidths, colors } from "../../constants/colors";
import {
  setFeedbackStatus,
  subscribeFeedbackStatus,
  type FeedbackStatusPayload,
} from "../../lib/feedbackBridge";

export default function AddScreen() {
  const [content, setContent] = useState("");
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const textInputRef = useRef<TextInput>(null);
  const createCard = useCreateCard();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const feedbackVisibleRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeFeedbackStatus((payload) => {
      if (!payload) {
        feedbackVisibleRef.current = false;
      }
    });
    return unsubscribe;
  }, []);

  const showFeedback = useCallback(
    (payload: FeedbackStatusPayload) => {
      setFeedbackStatus(payload);

      if (!feedbackVisibleRef.current) {
        feedbackVisibleRef.current = true;
        router.push("/(feedback)");
      }
    },
    [router]
  );

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
          setRecordingDuration(audioRecorder.currentTime);
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
    mimeType: string
  ) => {
    try {
      showSavingFeedback();
      // Convert React Native file URI to Blob for the shared upload hook
      const response = await fetch(fileUri);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: mimeType });

      await uploadFile(file, {
        content: fileName,
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

  const handleFilePicker = async () => {
    try {
      // Show options for different types of file selection
      Alert.alert(
        "Select File Type",
        "Choose the type of file you want to upload",
        [
          {
            text: "Photo/Video from Gallery",
            onPress: async () => {
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
                  asset.type === "video" ? "video/mp4" : "image/jpeg"
                );
              }
            },
          },
          {
            text: "Take Photo/Video",
            onPress: async () => {
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
                  asset.type === "video" ? "video/mp4" : "image/jpeg"
                );
              }
            },
          },
          {
            text: "Other Files",
            onPress: async () => {
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
            },
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
    } catch (error) {
      console.error("File upload error:", error);
      Alert.alert("Error", "Failed to upload file");
    }
  };

  const handleSave = async () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      Alert.alert("Error", "Please enter some content");
      return;
    }

    setIsSavingCard(true);
    showSavingFeedback();

    try {
      // Let backend handle type detection and processing
      await createCard({
        content: trimmedContent,
      });

      setContent("");
      textInputRef.current?.focus();
      showSavedFeedback();
    } catch (error) {
      console.error("Failed to save card:", error);
      showErrorFeedback("Failed to save card. Please try again.");
      Alert.alert("Error", "Failed to save card. Please try again.");
    } finally {
      setIsSavingCard(false);
    }
  };

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
        <Text style={{ color: colors.label, marginBottom: 40 }}>
          Recording...
        </Text>
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
        <Text
          style={{
            color: colors.secondaryLabel,
          }}
        >
          {new Date(recordingDuration * 1000).toISOString().substring(14, 19)}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          autoCapitalize="sentences"
          autoCorrect={true}
          editable={!uploadState.isUploading && !isSavingCard}
          multiline
          onChangeText={setContent}
          placeholder="Enter your bookmark, URL, or note"
          ref={textInputRef}
          style={{
            borderWidth: borderWidths.hairline,
            borderColor: colors.border,
            padding: 16,
            backgroundColor: colors.background,
            minHeight: 150,
            textAlignVertical: "top",
            color: colors.label,
            marginTop: 16,
            marginHorizontal: 16,
            borderRadius: 12,
          }}
          value={content}
        />

        <View style={{ flexDirection: "row", margin: 16, gap: 8 }}>
          <TouchableOpacity
            disabled={uploadState.isUploading || isSavingCard}
            onPress={handleFilePicker}
            style={{
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: colors.background,
              borderWidth: borderWidths.hairline,
              borderColor: colors.border,
              width: 50,
              height: 50,
              opacity: uploadState.isUploading || isSavingCard ? 0.5 : 1,
            }}
          >
            <IconSymbol
              color={colors.secondaryLabel}
              name="paperclip"
              size={20}
            />
          </TouchableOpacity>

          <TouchableOpacity
            disabled={uploadState.isUploading || isSavingCard}
            onPress={startRecording}
            style={{
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: colors.background,
              borderWidth: borderWidths.hairline,
              borderColor: colors.border,
              width: 50,
              height: 50,
              opacity: uploadState.isUploading || isSavingCard ? 0.5 : 1,
            }}
          >
            <IconSymbol
              color={colors.secondaryLabel}
              name="mic.fill"
              size={20}
            />
          </TouchableOpacity>

          <TouchableOpacity
            disabled={
              uploadState.isUploading || isSavingCard || !content.trim()
            }
            onPress={handleSave}
            style={{
              flex: 1,
              borderRadius: 12,
              height: 50,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.primary,
              opacity:
                uploadState.isUploading || isSavingCard || !content.trim()
                  ? 0.3
                  : 1,
            }}
          >
            <Text style={{ fontWeight: "600", color: colors.adaptiveWhite }}>
              {uploadState.isUploading || isSavingCard ? "Saving..." : "Save"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
