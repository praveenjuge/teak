import { test, expect } from "bun:test";
import { stopAudioRecording } from "./recording";

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

  resolveStop?.();
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
