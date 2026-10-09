import { Button, Host, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  contentTransition,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
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
  let recordingStatus = "Tap to start recording";
  if (isStoppingRecording || uploadState.isUploading) {
    recordingStatus = "Saving…";
  } else if (isRecording) {
    recordingStatus = "Recording";
  }

  return (
    <>
      <Stack.Screen options={{ title: "Voice Memo" }} />
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {/* Voice Memos-style: a large running timer over one round control. */}
        <VStack
          alignment="center"
          modifiers={[padding({ horizontal: 24, top: 24, bottom: 32 })]}
          spacing={8}
        >
          <Spacer />
          <Text
            modifiers={[
              font({ design: "rounded", size: 56, weight: "semibold" }),
              monospacedDigit(),
              contentTransition("numericText"),
            ]}
          >
            {formattedDuration}
          </Text>
          <Text
            modifiers={[
              font({ design: "rounded", size: 15 }),
              foregroundStyle({ type: "hierarchical", style: "secondary" }),
            ]}
          >
            {recordingStatus}
          </Text>
          <Spacer />
          <Button
            modifiers={[
              buttonStyle("glassProminent"),
              buttonBorderShape("circle"),
              controlSize("extraLarge"),
              tint(colors.systemRed),
              disabled(isStoppingRecording || uploadState.isUploading),
              accessibilityLabel(isRecording ? "Stop recording" : "Record"),
            ]}
            onPress={() =>
              void (isRecording ? stopRecording() : startRecording())
            }
          >
            <Image
              modifiers={[frame({ width: 44, height: 44 })]}
              size={26}
              systemName={isRecording ? "stop.fill" : "mic.fill"}
            />
          </Button>
        </VStack>
      </Host>
    </>
  );
}
