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

export const expandedFileFixtures = (marker: string): FileFixture[] => [
  {
    bytes: strToU8(`export const marker = "${marker}";`),
    fileName: `${marker}.tsx`,
    mimeType: "text/tsx",
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
    bytes: strToU8("ftypheic"),
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
];

export const cliFileFixtures = (marker: string): FileFixture[] => {
  const wanted = new Set(["tsx", "mdx", "zip", "svg", "gif", "fig"]);
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
