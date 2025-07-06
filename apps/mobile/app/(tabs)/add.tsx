import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useState, useRef, useEffect } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import { useCreateCard } from "../../lib/hooks";
import type { Card } from "../../lib/api";
import { apiClient } from "../../lib/api";
import { colors, borderWidths } from "../../constants/colors";
import { IconSymbol } from "../../components/ui/IconSymbol";
import { useMutation, useQueryClient } from "@tanstack/react-query";

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function detectCardType(content: string): {
  type: Card["type"];
  data: Record<string, any>;
} {
  const trimmedContent = content.trim();

  if (isUrl(trimmedContent)) {
    try {
      const url = new URL(trimmedContent);
      return {
        type: "url",
        data: {
          url: trimmedContent,
          title: url.hostname,
          description: `Saved from ${url.hostname}`,
        },
      };
    } catch {
      // Fallback if URL parsing fails
      return {
        type: "url",
        data: {
          url: trimmedContent,
          title: trimmedContent,
        },
      };
    }
  }

  return {
    type: "text",
    data: {
      content: trimmedContent,
      title:
        trimmedContent.slice(0, 50) + (trimmedContent.length > 50 ? "..." : ""),
    },
  };
}

export default function AddScreen() {
  const [content, setContent] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const textInputRef = useRef<TextInput>(null);
  const createCardMutation = useCreateCard();
  const queryClient = useQueryClient();

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

  const createFileCardMutation = useMutation({
    mutationFn: async ({
      fileUri,
      fileName,
      mimeType,
      cardData,
    }: {
      fileUri: string;
      fileName: string;
      mimeType: string;
      cardData?: {
        type?: Card["type"];
        data?: Record<string, any>;
        metaInfo?: Record<string, any>;
      };
    }) => {
      setIsUploading(true);
      return apiClient.createCardWithFile(
        fileUri,
        fileName,
        mimeType,
        cardData
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      Alert.alert("Success", "File uploaded successfully!");
      setIsUploading(false);
    },
    onError: (error) => {
      console.error("Failed to upload file:", error);
      Alert.alert("Error", "Failed to upload file. Please try again.");
      setIsUploading(false);
    },
  });

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
    if (!recording) return;

    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
    });
    const uri = recording.getURI();
    if (uri) {
      createFileCardMutation.mutate({
        fileUri: uri,
        fileName: `recording-${Date.now()}.m4a`,
        mimeType: "audio/m4a",
        cardData: {
          type: "audio",
          metaInfo: {
            source: "Mobile Voice Recording",
            recordingDuration: recordingDuration,
            tags: ["voice-note"],
          },
        },
      });
    }
    setRecording(null);
    setRecordingDuration(0);
  }

  const handleFileUpload = async () => {
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
                createFileCardMutation.mutate({
                  fileUri: asset.uri,
                  fileName:
                    asset.fileName ||
                    `upload_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
                  mimeType: asset.type === "video" ? "video/mp4" : "image/jpeg",
                  cardData: {
                    metaInfo: {
                      source: "Mobile Upload",
                      tags: [],
                    },
                  },
                });
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
                createFileCardMutation.mutate({
                  fileUri: asset.uri,
                  fileName:
                    asset.fileName ||
                    `capture_${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`,
                  mimeType: asset.type === "video" ? "video/mp4" : "image/jpeg",
                  cardData: {
                    metaInfo: {
                      source: "Mobile Camera",
                      tags: [],
                    },
                  },
                });
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
                  createFileCardMutation.mutate({
                    fileUri: asset.uri,
                    fileName: asset.name,
                    mimeType: asset.mimeType || "application/octet-stream",
                    cardData: {
                      metaInfo: {
                        source: "Mobile File Picker",
                        tags: [],
                      },
                    },
                  });
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

  const handleSave = () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      Alert.alert("Error", "Please enter some content");
      return;
    }

    const { type, data } = detectCardType(trimmedContent);

    createCardMutation.mutate(
      {
        type,
        data,
        metaInfo: {
          source: "Mobile App",
          tags: [],
        },
      },
      {
        onSuccess: () => {
          setContent("");
          textInputRef.current?.focus();
          Alert.alert("Success", "Card saved successfully!");
        },
        onError: (error) => {
          console.error("Failed to save card:", error);
          Alert.alert("Error", "Failed to save card. Please try again.");
        },
      }
    );
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
        <Text style={{ fontSize: 24, color: colors.label, marginBottom: 20 }}>
          Recording...
        </Text>
        <Text
          style={{
            fontSize: 20,
            color: colors.secondaryLabel,
            marginBottom: 40,
          }}
        >
          {new Date(recordingDuration * 1000).toISOString().substr(14, 5)}
        </Text>
        <TouchableOpacity
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: "red",
            justifyContent: "center",
            alignItems: "center",
          }}
          onPress={stopRecording}
        >
          <IconSymbol name="stop.fill" size={40} color="white" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
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
          placeholder="Enter your bookmark, URL, or note"
          value={content}
          onChangeText={setContent}
          multiline
          autoCapitalize="sentences"
          autoCorrect={true}
          editable={!createCardMutation.isPending && !isUploading}
        />

        <View style={{ flexDirection: "row", margin: 16, gap: 8 }}>
          <TouchableOpacity
            style={{
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: colors.background,
              borderWidth: borderWidths.hairline,
              borderColor: colors.border,
              width: 50,
              height: 50,
              opacity: isUploading ? 0.5 : 1,
            }}
            onPress={handleFileUpload}
            disabled={isUploading}
          >
            <IconSymbol
              name="paperclip"
              size={20}
              color={colors.secondaryLabel}
            />
          </TouchableOpacity>

          <TouchableOpacity
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
            onPress={startRecording}
          >
            <IconSymbol
              name="mic.fill"
              size={20}
              color={colors.secondaryLabel}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              borderRadius: 12,
              height: 50,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.primary,
              opacity:
                createCardMutation.isPending || isUploading || !content.trim()
                  ? 0.3
                  : 1,
            }}
            onPress={handleSave}
            disabled={
              createCardMutation.isPending || isUploading || !content.trim()
            }
          >
            <Text style={{ fontWeight: "600", color: colors.adaptiveWhite }}>
              {createCardMutation.isPending || isUploading
                ? "Saving..."
                : "Save Card"}
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
              borderLeftColor: isUrl(content.trim())
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
              {isUrl(content.trim()) ? "🔗 URL Detected" : "📝 Text Note"}
            </Text>
            {isUrl(content.trim()) && (
              <Text
                style={{
                  color: colors.secondaryLabel,
                  marginTop: 4,
                }}
              >
                This will be saved as a bookmark
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
