import { test, expect } from "bun:test";
import { stopAudioRecording } from "../../lib/recording";

test("stopAudioRecording waits for stop before unlocking recording state", async () => {
  const events: string[] = [];

  let resolveStop: (() => void) | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  const audioRecorder = {
    isRecording: true,
    uri: "file://recording.m4a",
    stop: async () => {
      events.push("stop-start");
      await stopPromise;
      events.push("stop-end");
    },
  };

  const stopTask = stopAudioRecording({
    audioRecorder,
    setIsRecording: (value) => {
      events.push(`setIsRecording:${value}`);
    },
    setIsStoppingRecording: (value) => {
      events.push(`setIsStoppingRecording:${value}`);
    },
    setRecordingDuration: (value) => {
      events.push(`setRecordingDuration:${value}`);
    },
    handleFileUpload: async () => {
      events.push("upload");
    },
  });

  await Promise.resolve();

  expect(events).toEqual([
    "setIsStoppingRecording:true",
    "stop-start",
  ]);

  (resolveStop as unknown as () => void)?.();
  await stopTask;

  expect(events).toEqual([
    "setIsStoppingRecording:true",
    "stop-start",
    "stop-end",
    "upload",
    "setIsRecording:false",
    "setRecordingDuration:0",
    "setIsStoppingRecording:false",
  ]);
});

test("stopAudioRecording early returns if not recording", async () => {
  const events: string[] = [];
  await stopAudioRecording({
    audioRecorder: {
      isRecording: false,
      uri: null,
      stop: async () => { },
    },
    setIsRecording: () => events.push("setIsRecording"),
    setIsStoppingRecording: () => events.push("setIsStoppingRecording"),
    setRecordingDuration: () => { },
    handleFileUpload: async () => { },
  });
  expect(events.length).toBe(0);
});

test("handles upload error", async () => {
  const error = new Error("Upload failed");
  const audioRecorder = {
    isRecording: true,
    uri: "file://recording.m4a",
    stop: async () => { },
  };
  let capturedError;
  await stopAudioRecording({
    audioRecorder,
    setIsRecording: () => { },
    setIsStoppingRecording: () => { },
    setRecordingDuration: () => { },
    handleFileUpload: async () => { throw error; },
    onError: (e) => { capturedError = e; },
  });
  expect(capturedError).toBe(error);
});

test("handles stop error", async () => {
  const error = new Error("Stop failed");
  const audioRecorder = {
    isRecording: true,
    stop: async () => { throw error; },
    uri: "file://recording.m4a",
  };
  let capturedError;
  await stopAudioRecording({
    audioRecorder,
    setIsRecording: () => { },
    setIsStoppingRecording: () => { },
    setRecordingDuration: () => { },
    handleFileUpload: async () => { },
    onError: (e) => { capturedError = e; },
  });
  expect(capturedError).toBe(error);
});
