import {
  Button,
  Host,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { colors } from "@/constants/colors";
import { triggerSuccessHaptic } from "@/lib/haptics";
import { useUploadFromUri } from "@/lib/hooks/use-upload-from-uri";
import { stopAudioRecording } from "@/lib/recording";

export default function AddRecordScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const { uploadFromUri, uploadState } = useUploadFromUri({
    onError: (error) => {
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        Alert.alert("Upgrade Required", error.message);
      } else {
        Alert.alert("Error", error.message || "Failed to upload recording.");
      }
    },
    onSuccess: () => {
      void triggerSuccessHaptic();
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
        Alert.alert("Error", "Failed to save recording. Please try again.");
      },
      setIsRecording,
      setIsStoppingRecording,
      setRecordingDuration,
    });
  }

  const formattedDuration = new Date(recordingDuration * 1000)
    .toISOString()
    .slice(14, 19);

  return (
    <>
      <Stack.Screen options={{ title: "Record Audio" }} />
      <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
        <VStack
          alignment="center"
          modifiers={[padding({ horizontal: 24, vertical: 40 })]}
          spacing={24}
        >
          <Spacer />

          <Text modifiers={[font({ design: "rounded", size: 48 })]}>
            {formattedDuration}
          </Text>

          <Spacer />

          {isRecording ? (
            <Button
              modifiers={[
                buttonStyle("borderedProminent"),
                controlSize("large"),
                tint(colors.primary),
                disabled(isStoppingRecording || uploadState.isUploading),
              ]}
              onPress={() => void stopRecording()}
            >
              <HStack alignment="center" spacing={6}>
                <Spacer />
                <Image size={12} systemName="stop.fill" />
                <Text
                  modifiers={[font({ design: "rounded", weight: "medium" })]}
                >
                  {isStoppingRecording ? "Saving..." : "Stop"}
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
                disabled(uploadState.isUploading),
              ]}
              onPress={() => void startRecording()}
            >
              <HStack alignment="center" spacing={6}>
                <Spacer />
                <Image size={12} systemName="mic.fill" />
                <Text
                  modifiers={[font({ design: "rounded", weight: "medium" })]}
                >
                  Record
                </Text>
                <Spacer />
              </HStack>
            </Button>
          )}
        </VStack>
      </Host>
    </>
  );
}
