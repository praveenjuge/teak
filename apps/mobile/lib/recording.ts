export interface AudioRecorderLike {
  isRecording: boolean;
  stop: () => Promise<void>;
  uri: string | null;
}

interface StopRecordingParams {
  audioRecorder: AudioRecorderLike;
  handleFileUpload: (
    uri: string,
    fileName: string,
    mimeType: string
  ) => Promise<void>;
  onError?: (error: unknown) => void;
  setIsRecording: (value: boolean) => void;
  setIsStoppingRecording: (value: boolean) => void;
  setRecordingDuration: (value: number) => void;
}

export async function stopAudioRecording({
  audioRecorder,
  setIsRecording,
  setIsStoppingRecording,
  setRecordingDuration,
  handleFileUpload,
  onError,
}: StopRecordingParams) {
  if (!audioRecorder.isRecording) {
    // Already stopped
    return;
  }

  setIsStoppingRecording(true);

  try {
    await audioRecorder.stop();

    const uri = audioRecorder.uri;
    if (uri) {
      await handleFileUpload(uri, `recording-${Date.now()}.m4a`, "audio/mp4");
    }
  } catch (error) {
    onError?.(error);
  } finally {
    setIsRecording(false);
    setRecordingDuration(0);
    setIsStoppingRecording(false);
  }
}
