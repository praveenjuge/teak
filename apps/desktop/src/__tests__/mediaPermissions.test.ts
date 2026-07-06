// @ts-nocheck
import { describe, expect, it } from "bun:test";
import {
  isMicrophoneCheck,
  isMicrophoneOnlyRequest,
} from "../main/mediaPermissions";

describe("desktop media permissions", () => {
  describe("isMicrophoneOnlyRequest", () => {
    it("grants an audio-only request (getUserMedia({ audio: true }))", () => {
      expect(isMicrophoneOnlyRequest(["audio"])).toBe(true);
    });

    it("denies a camera-only request", () => {
      expect(isMicrophoneOnlyRequest(["video"])).toBe(false);
    });

    it("denies a combined audio + video request so the camera is never granted", () => {
      expect(isMicrophoneOnlyRequest(["audio", "video"])).toBe(false);
      expect(isMicrophoneOnlyRequest(["video", "audio"])).toBe(false);
    });

    it("denies when no media types are provided", () => {
      expect(isMicrophoneOnlyRequest(undefined)).toBe(false);
      expect(isMicrophoneOnlyRequest([])).toBe(false);
    });
  });

  describe("isMicrophoneCheck", () => {
    it("grants the microphone (audio) check", () => {
      expect(isMicrophoneCheck("audio")).toBe(true);
    });

    it("denies camera, unknown, and missing media-type checks", () => {
      expect(isMicrophoneCheck("video")).toBe(false);
      expect(isMicrophoneCheck("unknown")).toBe(false);
      expect(isMicrophoneCheck(undefined)).toBe(false);
    });
  });
});
