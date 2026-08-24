import { describe, expect, test } from "bun:test";
import { expandedFileFixtures, validWebmAudio } from "./file-formats";

describe("production file fixtures", () => {
  test("uses a real WebM container for audio uploads", () => {
    expect(Array.from(validWebmAudio.slice(0, 4))).toEqual([
      0x1a, 0x45, 0xdf, 0xa3,
    ]);
    expect(
      expandedFileFixtures("fixture").find(
        (fixture) => fixture.mimeType === "audio/webm"
      )?.bytes
    ).toBe(validWebmAudio);
  });
});
