import { describe, expect, test } from "bun:test";
import {
  collapseRollingCaptions,
  cutTranscript,
  parseWebVtt,
  webVttToTranscript,
} from "../../../../workflows/steps/captions/parse";

const vtt = (...cues: string[]) =>
  `WEBVTT\n\n${cues
    .map(
      (cue, i) => `${i + 1}\n00:00:0${i}.000 --> 00:00:0${i + 1}.000\n${cue}`
    )
    .join("\n\n")}\n`;

describe("parseWebVtt", () => {
  test("reads each cue's text without markup or settings", () => {
    const file = [
      "﻿WEBVTT - a talk",
      "",
      "NOTE written by hand",
      "",
      "STYLE",
      "::cue { color: lime }",
      "",
      "00:00:01.000 --> 00:00:03.000 align:start position:10%",
      "<v Ada><i>Hello</i> &amp; welcome.</v>",
      "",
      "intro",
      "00:00:03.000 --> 00:00:05.000",
      "Today:",
      "<c.yellow>leaves</c> &lt;3",
      "",
      "00:00:05.000 --> 00:00:06.000",
      "",
    ].join("\r\n");

    expect(parseWebVtt(file)).toEqual(["Hello & welcome.", "Today: leaves <3"]);
  });

  test("tags nested to rebuild a tag leave no tag behind", () => {
    const [cue] = parseWebVtt(vtt("<scr<b>ipt>Nested</b> <<i>c>tags</c>"));
    expect(cue).not.toContain("<");
    expect(cue).toContain("Nested");
  });

  test("refuses a body that isn't WebVTT", () => {
    expect(() => parseWebVtt("<html>Sorry</html>")).toThrow("not_webvtt");
  });

  test("keeps CJK text whole", () => {
    expect(parseWebVtt(vtt("こんにちは、", "世界"))).toEqual([
      "こんにちは、",
      "世界",
    ]);
  });
});

describe("collapseRollingCaptions", () => {
  test.each([
    [["a b", "a b"], ["a b"]],
    [["so today", "so today we talk"], ["so today we talk"]],
    [
      ["so today we talk", "we talk about leaves"],
      ["so today we talk", "about leaves"],
    ],
    [["about leaves and", "leaves and"], ["about leaves and"]],
    [
      ["first line", "second line"],
      ["first line", "second line"],
    ],
    // A cue that only shares part of a word with the last one is new text.
    [
      ["the category", "gory details"],
      ["the category", "gory details"],
    ],
    [
      ["it was a category", "gory"],
      ["it was a category", "gory"],
    ],
    [
      ["car", "carpet sale"],
      ["car", "carpet sale"],
    ],
  ])("%p becomes %p", (cues, expected) => {
    expect(collapseRollingCaptions(cues)).toEqual(expected);
  });
});

describe("cutTranscript", () => {
  test("leaves text under the cap as it is", () => {
    expect(cutTranscript("short text", 100)).toBe("short text");
  });

  test("cuts on a word boundary within the byte cap", () => {
    expect(cutTranscript("one two three four", 12)).toBe("one two");
  });

  test("never splits a multi-byte character", () => {
    const cut = cutTranscript("葉 葉 葉 葉 葉", 8);
    expect(new TextEncoder().encode(cut).byteLength).toBeLessThanOrEqual(8);
    expect(cut).toBe("葉 葉");
  });

  test("a 10-hour track is cut at 512 KiB", () => {
    const cues = Array.from(
      { length: 40_000 },
      (_, i) => `cue ${i} says words`
    );
    const text = webVttToTranscript(
      `WEBVTT\n\n${cues.map((cue) => `00:00:00.000 --> 00:00:01.000\n${cue}`).join("\n\n")}`
    );
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
      512 * 1024
    );
    expect(text.startsWith("cue 0 says words cue 1")).toBe(true);
    expect(text.endsWith(" ")).toBe(false);
  });
});

describe("webVttToTranscript", () => {
  test("joins the cues and collapses rolling repeats", () => {
    expect(
      webVttToTranscript(
        vtt("so today", "so today we talk", "we talk about leaves")
      )
    ).toBe("so today we talk about leaves");
  });

  test("a file with no words is empty", () => {
    expect(webVttToTranscript("WEBVTT\n\n")).toBe("");
  });
});
