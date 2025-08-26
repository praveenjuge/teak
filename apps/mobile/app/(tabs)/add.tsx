import { Audio } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
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
import { useCreateCard, useFileUpload } from "@teak/shared";
import { IconSymbol } from "../../components/ui/IconSymbol";
import { borderWidths, colors } from "../../constants/colors";
import type { Doc } from "@teak/convex/_generated/dataModel";

type Card = Doc<"cards">;

// Utility functions
function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

export default function AddScreen() {
  const [content, setContent] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const textInputRef = useRef<TextInput>(null);
  const createCard = useCreateCard();

  // Use shared file upload hook
  const { uploadFile, state: uploadState } = useFileUpload({
    onSuccess: (cardId) => {
      Alert.alert("Success", "File uploaded successfully!");
    },
    onError: (error) => {
      Alert.alert("Error", error);
    },
  });

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRecording) {
      interval = setInterval(async () => {
        const status = await recording?.getStatusAsync();
        if (status?.isRecording) {
          setRecordingDuration(status.durationMillis / 1000);
        }
      }, 1000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isRecording, recording]);

  const handleFileUpload = async (
    fileUri: string,
    fileName: string,
    mimeType: string
  ) => {
    try {
      // Convert React Native file URI to Blob for the shared upload hook
      const response = await fetch(fileUri);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: mimeType });

      await uploadFile(file, {
        content: fileName,
        additionalMetadata: {
          originalUri: fileUri,
          platform: "mobile",
        },
      });
    } catch (error) {
      console.error("Failed to upload file:", error);
      Alert.alert("Error", "Failed to upload file. Please try again.");
    }
  };

  async function startRecording() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission required",
          "Permission to access microphone is required!"
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
      setRecordingDuration(0);
    } catch (err) {
      console.error("Failed to start recording", err);
      Alert.alert("Error", "Failed to start recording.");
    }
  }

  async function stopRecording() {
    if (!recording) {
      return;
    }

    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });
    const uri = recording.getURI();
    if (uri) {
      await handleFileUpload(uri, `recording-${Date.now()}.m4a`, "audio/m4a");
    }
    setRecording(null);
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
                mediaTypes: ImagePicker.MediaTypeOptions.All,
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
                mediaTypes: ImagePicker.MediaTypeOptions.All,
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

    try {
      // Let backend handle type detection and processing
      await createCard({
        content: trimmedContent,
      });

      setContent("");
      textInputRef.current?.focus();
      Alert.alert("Success", "Card saved successfully!");
    } catch (error) {
      console.error("Failed to save card:", error);
      Alert.alert("Error", "Failed to save card. Please try again.");
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
          {new Date(recordingDuration * 1000).toISOString().substr(14, 5)}
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
          editable={!uploadState.isUploading}
          multiline
          onChangeText={setContent}
          placeholder="Enter your bookmark, URL, or note"
          ref={textInputRef}
          style={{
            borderBottomWidth: borderWidths.hairline,
            borderColor: colors.border,
            padding: 16,
            backgroundColor: colors.background,
            minHeight: 150,
            textAlignVertical: "top",
            color: colors.label,
          }}
          value={content}
        />

        <View style={{ flexDirection: "row", margin: 16, gap: 8 }}>
          <TouchableOpacity
            disabled={uploadState.isUploading}
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
              opacity: uploadState.isUploading ? 0.5 : 1,
            }}
          >
            <IconSymbol
              color={colors.secondaryLabel}
              name="paperclip"
              size={20}
            />
          </TouchableOpacity>

          <TouchableOpacity
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
            }}
          >
            <IconSymbol
              color={colors.secondaryLabel}
              name="mic.fill"
              size={20}
            />
          </TouchableOpacity>

          <TouchableOpacity
            disabled={uploadState.isUploading || !content.trim()}
            onPress={handleSave}
            style={{
              flex: 1,
              borderRadius: 12,
              height: 50,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.primary,
              opacity: uploadState.isUploading || !content.trim() ? 0.3 : 1,
            }}
          >
            <Text style={{ fontWeight: "600", color: colors.adaptiveWhite }}>
              {uploadState.isUploading ? "Saving..." : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content type indicator */}
        {content.trim() && (
          <View
            style={{
              backgroundColor: colors.background,
              padding: 12,
              borderRadius: 8,
              marginHorizontal: 20,
              borderLeftWidth: 4,
              borderLeftColor: isValidUrl(content.trim())
                ? colors.systemGreen
                : colors.primary,
            }}
          >
            <Text
              style={{
                color: colors.label,
                fontWeight: "500",
              }}
            >
              {isValidUrl(content.trim()) ? "🔗 URL Detected" : "📝 Text Note"}
            </Text>
            {isValidUrl(content.trim()) && (
              <Text
                style={{
                  color: colors.secondaryLabel,
                  marginTop: 4,
                }}
              >
                This will be automatically saved as a bookmark
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
