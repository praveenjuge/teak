import { Button, Host, HStack, List, Spacer, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  listStyle,
  scrollDisabled,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { colors } from "@/constants/colors";
import {
  showErrorFeedback,
  showSavingFeedback,
  showSuccessFeedback,
} from "@/lib/feedback-status";
import { useUploadFromUri } from "@/lib/hooks/use-upload-from-uri";
import { stopAudioRecording } from "@/lib/recording";

export default function AddRecordScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const { uploadFromUri, uploadState } = useUploadFromUri({
    onError: (error) => {
      showErrorFeedback(error.message || "Failed to upload recording.");
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        Alert.alert("Upgrade Required", error.message);
      } else {
        Alert.alert("Error", error.message || "Failed to upload recording.");
      }
    },
    onSuccess: () => {
      showSuccessFeedback("Recording saved successfully.");
      router.back();
    },
  });

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

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
  }, [audioRecorder, isRecording]);

  async function startRecording() {
    if (uploadState.isUploading || isStoppingRecording || isRecording) {
      return;
    }

    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert(
          "Permission Required",
          "Audio recording permission is required to record audio."
        );
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setRecordingDuration(0);
    } catch (error) {
      console.error(
        "Failed to start recording:",
        error instanceof Error ? error.message : error
      );
      Alert.alert("Error", "Failed to start recording.");
    }
  }

  async function stopRecording() {
    if (!audioRecorder.isRecording || isStoppingRecording) {
      return;
    }

    showSavingFeedback("Saving recording...");

    await stopAudioRecording({
      audioRecorder,
      handleFileUpload: async (uri, fileName, mimeType) => {
        await uploadFromUri({
          content: fileName,
          fileName,
          fileUri: uri,
          mimeType,
        });
      },
      onError: (error) => {
        console.error(
          "Failed to stop recording:",
          error instanceof Error ? error.message : error
        );
        showErrorFeedback("Failed to save recording. Please try again.");
        Alert.alert("Error", "Failed to save recording. Please try again.");
      },
      setIsRecording,
      setIsStoppingRecording,
      setRecordingDuration,
    });
  }

  return (
    <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
      <List modifiers={[listStyle("plain"), scrollDisabled()]}>
        <HStack alignment="center" spacing={8}>
          <Text
            modifiers={[
              foregroundStyle({
                style: "primary",
                type: "hierarchical",
              }),
              font({ design: "rounded" }),
            ]}
          >
            {isStoppingRecording
              ? "Stopping..."
              : isRecording
                ? "Recording..."
                : "Ready to record"}
          </Text>
          <Spacer />
          <Text
            modifiers={[
              foregroundStyle({
                style: "secondary",
                type: "hierarchical",
              }),
            ]}
          >
            {new Date(recordingDuration * 1000).toISOString().substring(14, 19)}
          </Text>
        </HStack>

        {isRecording ? (
          <Button
            modifiers={[
              buttonStyle("borderedProminent"),
              controlSize("large"),
              tint(colors.primary),
              disabled(isStoppingRecording),
            ]}
            onPress={stopRecording}
          >
            <HStack alignment="center" spacing={8}>
              <Spacer />
              <Text modifiers={[font({ design: "rounded" })]}>
                {isStoppingRecording ? "Stopping" : "Stop Recording"}
              </Text>
              <Spacer />
            </HStack>
          </Button>
        ) : (
          <Button
            modifiers={[
              buttonStyle("borderedProminent"),
              controlSize("large"),
              tint(colors.primary),
              disabled(uploadState.isUploading || isStoppingRecording),
            ]}
            onPress={startRecording}
          >
            <HStack alignment="center" spacing={8}>
              <Spacer />
              <Text
                modifiers={[
                  foregroundStyle({
                    style: "primary",
                    type: "hierarchical",
                  }),
                  font({ design: "rounded" }),
                ]}
              >
                Start Recording
              </Text>
              <Spacer />
            </HStack>
          </Button>
        )}
      </List>
    </Host>
  );
}
