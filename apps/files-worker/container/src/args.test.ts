import { describe, expect, test } from "bun:test";
import {
  audioCommand,
  FORMAT_WHITELIST,
  ffmpegCommand,
  ffprobeCommand,
  frameCommand,
  jobPath,
  MAX_ALLOC_BYTES,
  pdfInfoCommand,
  pdfPageCommand,
  pdfTextCommand,
  spriteCommand,
  tileCommand,
} from "./args";

const DIR = "/work/job-1";
const INPUT = `${DIR}/input`;
const frameJob = {
  jobDir: DIR,
  input: INPUT,
  streamIndex: 0,
  timeSeconds: 1,
  width: 320,
  height: 180,
  output: `${DIR}/frame.jpg`,
};

const ffmpegCommands: [string, string[]][] = [
  ["frame", frameCommand(frameJob)],
  ["tile", tileCommand({ ...frameJob, output: `${DIR}/tile-0.mkv` })],
  [
    "sprite",
    spriteCommand(
      DIR,
      [`${DIR}/tile-0.mkv`, `${DIR}/tile-1.mkv`],
      `${DIR}/s.jpg`
    ),
  ],
  ["audio", audioCommand(DIR, INPUT, 1, null)],
  ["audio+whisper", audioCommand(DIR, INPUT, 1, `${DIR}/whisper.mp3`)],
];

function valueAfter(
  argv: string[],
  flag: string,
  from = 0
): string | undefined {
  const index = argv.indexOf(flag, from);
  return index === -1 ? undefined : argv[index + 1];
}

describe("ffmpeg hardening", () => {
  test.each(ffmpegCommands)(
    "%s runs quiet, without stdin, with an allocation cap",
    (_, argv) => {
      expect(argv[0]).toBe("ffmpeg");
      expect(argv).toContain("-nostdin");
      expect(argv).toContain("-hide_banner");
      expect(valueAfter(argv, "-loglevel")).toBe("error");
      expect(valueAfter(argv, "-max_alloc")).toBe(String(MAX_ALLOC_BYTES));
      expect(valueAfter(argv, "-filter_threads")).toBe("1");
    }
  );

  test.each(ffmpegCommands)(
    "%s restricts every input to local files and real containers",
    (_, argv) => {
      const inputs = argv.flatMap((arg, index) =>
        arg === "-i" ? [index] : []
      );
      expect(inputs.length).toBeGreaterThan(0);
      let previous = 0;
      for (const index of inputs) {
        const options = argv.slice(previous, index);
        expect(valueAfter(options, "-protocol_whitelist")).toBe("file,pipe");
        expect(valueAfter(options, "-format_whitelist")).toBe(FORMAT_WHITELIST);
        expect(valueAfter(options, "-threads")).toBe("1");
        expect(argv[index + 1]).toStartWith(`file:${DIR}/`);
        previous = index + 2;
      }
    }
  );

  test.each(ffmpegCommands)(
    "%s writes only into the job directory or stdout",
    (_, argv) => {
      const outputs = argv.filter(
        (_arg, index) =>
          argv[index - 1] === "-1" && argv[index - 2] === "-map_metadata"
      );
      expect(outputs.length).toBeGreaterThan(0);
      for (const output of outputs) {
        expect(output === "pipe:1" || output.startsWith(`file:${DIR}/`)).toBe(
          true
        );
      }
    }
  );

  test("the demuxer allow-list leaves out playlists, lists, sequences and generators", () => {
    const allowed = FORMAT_WHITELIST.split(",");
    for (const banned of [
      "hls",
      "applehttp",
      "dash",
      "concat",
      "image2",
      "image2pipe",
      "lavfi",
      "data",
      "tee",
      "rtsp",
      "sdp",
      "rtp",
      "http",
    ]) {
      expect(allowed).not.toContain(banned);
    }
    expect(allowed).toEqual(
      expect.arrayContaining(["mov", "matroska", "mp3", "wav"])
    );
  });

  test("ffprobe gets the same input restrictions", () => {
    const argv = ffprobeCommand(DIR, INPUT);
    expect(argv[0]).toBe("ffprobe");
    expect(argv).toContain("-hide_banner");
    expect(valueAfter(argv, "-loglevel")).toBe("error");
    expect(valueAfter(argv, "-protocol_whitelist")).toBe("file,pipe");
    expect(valueAfter(argv, "-format_whitelist")).toBe(FORMAT_WHITELIST);
    expect(valueAfter(argv, "-threads")).toBe("1");
    expect(valueAfter(argv, "-max_alloc")).toBe(String(MAX_ALLOC_BYTES));
    expect(argv.at(-1)).toBe(`file:${INPUT}`);
  });

  test.each([
    ["a URL", "http://example.com/x.mp4"],
    ["a relative path", "input"],
    ["a sibling job", "/work/job-2/input"],
    ["an escape", `${DIR}/../job-2/input`],
    ["the job dir itself", DIR],
  ])("refuses %s as an input or output path", (_, path) => {
    expect(() => jobPath(DIR, path)).toThrow();
    expect(() => ffprobeCommand(DIR, path)).toThrow();
    expect(() => ffmpegCommand(DIR, [{ path }], [])).toThrow();
    expect(() =>
      ffmpegCommand(DIR, [{ path: INPUT }], [{ target: path, options: [] }])
    ).toThrow();
  });
});

describe("job commands", () => {
  test("the thumbnail seeks accurately to one frame and scales to the given size", () => {
    const argv = frameCommand(frameJob);
    expect(argv.indexOf("-ss")).toBeLessThan(argv.indexOf("-i"));
    expect(valueAfter(argv, "-ss")).toBe("1");
    expect(argv).not.toContain("-noaccurate_seek");
    expect(valueAfter(argv, "-frames:v")).toBe("1");
    expect(valueAfter(argv, "-vf")).toBe("scale=320:180,setsar=1");
    expect(valueAfter(argv, "-map")).toBe("0:0");
  });

  test("tiles use a keyframe-only fast seek", () => {
    const argv = tileCommand({ ...frameJob, timeSeconds: 2.5 });
    const input = argv.indexOf("-i");
    expect(valueAfter(argv, "-skip_frame")).toBe("nokey");
    expect(argv.indexOf("-skip_frame")).toBeLessThan(input);
    expect(argv.indexOf("-ss")).toBeLessThan(input);
    expect(argv.indexOf("-noaccurate_seek")).toBeLessThan(input);
    expect(valueAfter(argv, "-frames:v")).toBe("1");
  });

  test("the sprite stacks every tile horizontally", () => {
    const tiles = [0, 1, 2].map((index) => `${DIR}/tile-${index}.mkv`);
    const argv = spriteCommand(DIR, tiles, `${DIR}/scrub.jpg`);
    expect(valueAfter(argv, "-filter_complex")).toBe(
      "[0:v][1:v][2:v]hstack=inputs=3[out]"
    );
  });

  test("audio decodes once to 8 kHz mono PCM on stdout", () => {
    const argv = audioCommand(DIR, INPUT, 2, null);
    expect(argv.filter((arg) => arg === "-i")).toHaveLength(1);
    expect(argv.at(-1)).toBe("pipe:1");
    expect(valueAfter(argv, "-ar")).toBe("8000");
    expect(valueAfter(argv, "-ac")).toBe("1");
    expect(valueAfter(argv, "-f", argv.indexOf("-ar"))).toBe("s16le");
    expect(valueAfter(argv, "-map")).toBe("0:2");
  });

  test("whisper output is a capped 16 kHz mono 32 kbps MP3 from the same decode", () => {
    const argv = audioCommand(DIR, INPUT, 0, `${DIR}/whisper.mp3`);
    expect(argv.filter((arg) => arg === "-i")).toHaveLength(1);
    const second = argv.indexOf("pipe:1") + 1;
    const tail = argv.slice(second);
    expect(valueAfter(tail, "-ar")).toBe("16000");
    expect(valueAfter(tail, "-ac")).toBe("1");
    expect(valueAfter(tail, "-b:a")).toBe("32k");
    expect(valueAfter(tail, "-c:a")).toBe("libmp3lame");
    expect(valueAfter(tail, "-fs")).toBe(String(32 * 1024 * 1024));
    expect(tail.at(-1)).toBe(`file:${DIR}/whisper.mp3`);
  });

  test("poppler commands read the spooled file and write inside the job", () => {
    expect(pdfInfoCommand(DIR, INPUT)).toEqual(["pdfinfo", INPUT]);
    expect(pdfPageCommand(DIR, INPUT, 1600, `${DIR}/page`)).toEqual([
      "pdftoppm",
      "-f",
      "1",
      "-l",
      "1",
      "-singlefile",
      "-png",
      "-scale-to",
      "1600",
      INPUT,
      `${DIR}/page`,
    ]);
    expect(pdfTextCommand(DIR, INPUT, 50)).toEqual([
      "pdftotext",
      "-f",
      "1",
      "-l",
      "50",
      "-enc",
      "UTF-8",
      "-q",
      INPUT,
      "-",
    ]);
    expect(() => pdfPageCommand(DIR, INPUT, 1600, "/tmp/page")).toThrow();
  });
});
