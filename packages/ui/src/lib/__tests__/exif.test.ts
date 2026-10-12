import { describe, expect, test } from "bun:test";
import { formatCamera, formatExifFields, formatExposureTime } from "../exif";

describe("formatExifFields", () => {
  test("lists a full photo's facts in reading order", () => {
    const fields = formatExifFields({
      exposureTime: 1 / 250,
      fNumber: 1.8,
      focalLength: 50,
      iso: 400,
      make: "Canon",
      model: "Canon EOS R5",
      takenAt: Date.UTC(2026, 4, 17, 9, 0, 5),
    });
    expect(fields.map((field) => field.label)).toEqual([
      "Camera",
      "Taken",
      "Exposure",
      "Aperture",
      "Focal length",
      "ISO",
    ]);
    expect(fields).toContainEqual({ label: "Camera", value: "Canon EOS R5" });
    expect(fields).toContainEqual({ label: "Exposure", value: "1/250 s" });
    expect(fields).toContainEqual({ label: "Aperture", value: "f/1.8" });
    expect(fields).toContainEqual({ label: "Focal length", value: "50 mm" });
    expect(fields).toContainEqual({ label: "ISO", value: "400" });
    expect(fields.find((field) => field.label === "Taken")?.value).toContain(
      "2026"
    );
  });

  test("never shows GPS coordinates, even when they are the only facts", () => {
    expect(formatExifFields({ latitude: 48.8584, longitude: 2.2945 })).toEqual(
      []
    );
    const rendered = JSON.stringify(
      formatExifFields({ iso: 100, latitude: 48.8584, longitude: 2.2945 })
    );
    expect(rendered).not.toContain("48.8");
    expect(rendered).not.toContain("2.29");
    expect(rendered.toLowerCase()).not.toMatch(
      /latitude|longitude|location|gps/u
    );
  });

  test.each([
    ["no exif", undefined],
    ["null exif", null],
    ["empty exif", {}],
    [
      "only invalid numbers",
      {
        exposureTime: 0,
        fNumber: -2,
        focalLength: Number.NaN,
        iso: Number.POSITIVE_INFINITY,
      },
    ],
    ["blank text", { make: "   ", model: "" }],
  ])("shows nothing for %s", (_label, exif) => {
    expect(formatExifFields(exif as never)).toEqual([]);
  });

  test("drops a trailing .0 and rounds odd values", () => {
    expect(formatExifFields({ fNumber: 8, focalLength: 23.99 })).toEqual([
      { label: "Aperture", value: "f/8" },
      { label: "Focal length", value: "24 mm" },
    ]);
  });
});

describe("formatCamera", () => {
  test.each([
    ["Apple", "iPhone 17 Pro", "Apple iPhone 17 Pro"],
    ["Canon", "Canon EOS R5", "Canon EOS R5"],
    ["NIKON CORPORATION", "NIKON Z 8", "NIKON Z 8"],
    ["  FUJIFILM ", "  X-T5  ", "FUJIFILM X-T5"],
    ["Sony", undefined, "Sony"],
    [undefined, "Pixel 9", "Pixel 9"],
  ])("%p + %p reads %p", (make, model, expected) => {
    expect(formatCamera(make, model)).toBe(expected);
  });

  test("returns null with neither make nor model", () => {
    expect(formatCamera(undefined, " ")).toBeNull();
  });
});

describe("formatExposureTime", () => {
  test.each([
    [1 / 4000, "1/4000 s"],
    [1 / 60, "1/60 s"],
    [1 / 4, "1/4 s"],
    [0.3, "0.3 s"],
    [1 / 3, "0.3 s"],
    [0.4, "0.4 s"],
    [0.6, "0.6 s"],
    [0.8, "0.8 s"],
    [1, "1 s"],
    [2.5, "2.5 s"],
    [30, "30 s"],
  ])("%p seconds reads %p", (seconds, expected) => {
    expect(formatExposureTime(seconds)).toBe(expected);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined])(
    "ignores %p",
    (seconds) => {
      expect(formatExposureTime(seconds)).toBeNull();
    }
  );
});
