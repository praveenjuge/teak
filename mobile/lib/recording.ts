export type AudioRecorderLike = {
  isRecording: boolean;
  uri: string | null;
  stop: () => Promise<void>;
};

type StopRecordingParams = {
  audioRecorder: AudioRecorderLike;
  setIsRecording: (value: boolean) => void;
  setIsStoppingRecording: (value: boolean) => void;
  setRecordingDuration: (value: number) => void;
  handleFileUpload: (
    uri: string,
    fileName: string,
    mimeType: string
  ) => Promise<void>;
  onError?: (error: unknown) => void;
};

export async function stopAudioRecording({
  audioRecorder,
  setIsRecording,
  setIsStoppingRecording,
  setRecordingDuration,
  handleFileUpload,
  onError,
}: StopRecordingParams) {
  if (!audioRecorder.isRecording) {
    return;
  }

  setIsStoppingRecording(true);

  try {
    await audioRecorder.stop();

    const uri = audioRecorder.uri;
    if (uri) {
      await handleFileUpload(uri, `recording-${Date.now()}.m4a`, "audio/m4a");
    }
  } catch (error) {
    onError?.(error);
  } finally {
    setIsRecording(false);
    setRecordingDuration(0);
    setIsStoppingRecording(false);
  }
}
