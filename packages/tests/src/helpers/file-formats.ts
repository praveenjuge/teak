import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";

export interface FileFixture {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

const tinyGif = Uint8Array.from(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64")
);

// A real 8x6 HEIC image (decodable by Cloudflare transformations); the upload
// pipeline rejects undecodable image bytes, so fixtures must be genuine.
const tinyHeic = Uint8Array.from(
  // biome-ignore format: long base64 fixture
  Buffer.from(
    "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoAABAAAAAAAAADIAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/GlwcnAAAADcaXBjbwAAAHVodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABNjb2xybmNseAABAA0ABoAAAAAUaXNwZQAAAAAAAABAAAAAQAAAAChjbGFwAAAACAAAAAEAAAAGAAAAAf///8gAAAAC////xgAAAAIAAAAQcGl4aQAAAAADCAgIAAAAGGlwbWEAAAAAAAAAAQABBYECAwWEAAAAOm1kYXQAAAAuKAGvEyFiY0D1JyL//0Nqf+o8J/2F2WFncrrBW/L6wPZkm8DzqpGegIdppzAVeA==",
    "base64"
  )
);

export const validWebmAudio = Uint8Array.from(
  Buffer.from(
    "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAKlEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggFCTbuMU6uEHFO7a1OsggKP7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiEBwIAAAAAAAFlSua+WuAQAAAAAAAFzXgQFzxYjr0TbJL9/JPpyBACK1nIN1bmSIgQCGhkFfT1BVU1aqg2MuoFa7hATEtACDgQLhkZ+BAbWIQM9AAAAAAABiZIEQY6KTT3B1c0hlYWQBATgBgD4AAAAAABJUw2f9c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2Mi4xMi4xMDJzc9djwItjxYjr0TbJL9/JPmfIokWjh0VOQ09ERVJEh5VMYXZjNjIuMjguMTAyIGxpYm9wdXNnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjI1ODAwMDAwMAAfQ7Z1QMXngQCjjIEAAIBIC+TBNuzFgKONgQAVgEgHyXIn4UTqUKOMgQApgEgHyXnIyVfAo4yBAD2ASAfJecjJV8CjjIEAUYBIB8l5yMlXwKOMgQBlgEgHyXnIyVfAo4yBAHmASAfJecjJV8CjjIEAjYBIB8l5yMlXwKOMgQChgEgHyXnIyVfAo4yBALWASAfJecjJV8CjjIEAyYBIB8l5yMlXwKOMgQDdgEgHyXnIyVfAo4yBAO2ASAfJecjJV8CjjIEA8QBIB8l5yMlXwJuBEXWigzVn4BxTu2uRu4+zgQC3iveBAfGCAcTwgQM=",
    "base64"
  )
);

export const expandedFileFixtures = (marker: string): FileFixture[] => [
  {
    bytes: strToU8(`export const marker = "${marker}";`),
    fileName: `${marker}.tsx`,
    mimeType: "text/tsx",
  },
  {
    bytes: strToU8(`\uFEFF  # ${marker}\r\n\r\n- [ ] exact Markdown  \n`),
    fileName: `${marker}.MD`,
    mimeType: "text/markdown",
  },
  {
    bytes: strToU8(`# ${marker}\n\nA safe **Markdown** fixture.`),
    fileName: `${marker}.mdx`,
    mimeType: "text/mdx",
  },
  {
    bytes: zipSync({ "readme.txt": strToU8(marker) }),
    fileName: `${marker}.zip`,
    mimeType: "application/zip",
  },
  {
    bytes: tinyHeic,
    fileName: `${marker}.heic`,
    mimeType: "image/heic",
  },
  {
    bytes: strToU8(
      `<svg xmlns="http://www.w3.org/2000/svg"><title>${marker}</title></svg>`
    ),
    fileName: `${marker}.svg`,
    mimeType: "image/svg+xml",
  },
  {
    bytes: tinyGif,
    fileName: `${marker}.gif`,
    mimeType: "image/gif",
  },
  {
    bytes: zipSync({
      "[Content_Types].xml": strToU8("<Types />"),
      "word/document.xml": strToU8(`<w:t>${marker}</w:t>`),
    }),
    fileName: `${marker}.docx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    bytes: zipSync({
      "[Content_Types].xml": strToU8("<Types />"),
      "ppt/slides/slide1.xml": strToU8(`<a:t>${marker}</a:t>`),
    }),
    fileName: `${marker}.pptx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  {
    bytes: strToU8(`figma-fixture-${marker}`),
    fileName: `${marker}.fig`,
    mimeType: "application/octet-stream",
  },
  {
    bytes: validWebmAudio,
    fileName: `${marker}-recording.webm`,
    mimeType: "audio/webm",
  },
];

export const cliFileFixtures = (marker: string): FileFixture[] => {
  const wanted = new Set(["tsx", "md", "mdx", "zip", "svg", "gif", "fig"]);
  return expandedFileFixtures(marker).filter((fixture) =>
    wanted.has(fixture.fileName.split(".").pop() ?? "")
  );
};

export const materializeFixtures = (
  fixtures: FileFixture[],
  directory = resolve("packages/tests/.state/file-fixtures")
): string[] => {
  mkdirSync(directory, { recursive: true });
  return fixtures.map((fixture) => {
    const filePath = resolve(directory, fixture.fileName);
    writeFileSync(filePath, fixture.bytes);
    return filePath;
  });
};
