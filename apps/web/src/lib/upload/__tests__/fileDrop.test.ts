import { describe, expect, test } from "bun:test";
import {
  capBatchForQueue,
  dataTransferHasFiles,
  describeUploadFailures,
  extractFilesFromDataTransfer,
  formatFileNames,
  formatPartialFailureMessage,
  formatSkippedNote,
  isBlockedDropTarget,
  isDataTransferItemFolder,
  summarizeBatchResults,
  uploadAcceptAttribute,
  uploadFailureKind,
} from "../fileDrop";

function makeFile(name: string, type = "text/plain"): File {
  return new File([name], name, { type });
}

function makeItem(
  file: File | null,
  { isDirectory = false, kind = "file" } = {}
): DataTransferItem {
  return {
    kind,
    type: file?.type ?? "",
    getAsFile: () => (isDirectory ? null : file),
    webkitGetAsEntry: () => ({
      isDirectory,
      isFile: !isDirectory,
    }),
  } as unknown as DataTransferItem;
}

function makeDataTransfer({
  items = [],
  files = [],
  types,
}: {
  items?: DataTransferItem[];
  files?: File[];
  types?: string[];
} = {}): DataTransfer {
  return {
    items,
    files,
    types: types ?? (items.length > 0 || files.length > 0 ? ["Files"] : []),
  } as unknown as DataTransfer;
}

describe("isDataTransferItemFolder", () => {
  test("returns true for directory entries", () => {
    expect(
      isDataTransferItemFolder(makeItem(null, { isDirectory: true }))
    ).toBe(true);
  });

  test("returns false for plain file entries", () => {
    expect(isDataTransferItemFolder(makeItem(makeFile("a.png")))).toBe(false);
  });

  test("returns false for non-file kinds", () => {
    expect(
      isDataTransferItemFolder(makeItem(makeFile("a.png"), { kind: "string" }))
    ).toBe(false);
  });
});

describe("extractFilesFromDataTransfer", () => {
  test("returns valid files and skips folders", () => {
    const fileItem = makeItem(makeFile("a.png", "image/png"));
    const folderItem = makeItem(null, { isDirectory: true });
    const { files, rejectedFolder } = extractFilesFromDataTransfer(
      makeDataTransfer({ items: [fileItem, folderItem] })
    );

    expect(files.map((f) => f.name)).toEqual(["a.png"]);
    expect(rejectedFolder).toBe(true);
  });

  test("falls back to dataTransfer.files when items is empty", () => {
    const files = [makeFile("a.png"), makeFile("b.png")];
    const { files: result, rejectedFolder } = extractFilesFromDataTransfer(
      makeDataTransfer({ files })
    );

    expect(result).toHaveLength(2);
    expect(rejectedFolder).toBe(false);
  });

  test("returns empty result for null transfer", () => {
    expect(extractFilesFromDataTransfer(null)).toEqual({
      files: [],
      rejectedFolder: false,
    });
  });
});

describe("dataTransferHasFiles", () => {
  test("returns true when items contain files", () => {
    expect(
      dataTransferHasFiles(
        makeDataTransfer({ items: [makeItem(makeFile("a.png"))] })
      )
    ).toBe(true);
  });

  test("returns false for text-only drags", () => {
    expect(
      dataTransferHasFiles(
        makeDataTransfer({
          items: [makeItem(makeFile("x"), { kind: "string" })],
          types: ["text/plain"],
        })
      )
    ).toBe(false);
  });

  test("ignores a card dragged within the app, even with its image file", () => {
    expect(
      dataTransferHasFiles(
        makeDataTransfer({
          items: [makeItem(makeFile("a.png"))],
          types: ["Files", "application/x-teak-card"],
        })
      )
    ).toBe(false);
  });

  test("falls back to Files type hint when items is empty", () => {
    expect(dataTransferHasFiles(makeDataTransfer({ types: ["Files"] }))).toBe(
      true
    );
  });
});

describe("isBlockedDropTarget", () => {
  test("blocks drops on textarea", () => {
    const target = {
      closest: (selector: string) =>
        selector.includes("textarea") ? ({} as Element) : null,
    } as unknown as EventTarget;
    expect(isBlockedDropTarget(target)).toBe(true);
  });

  test("blocks drops inside dialogs", () => {
    const target = {
      closest: (selector: string) =>
        selector.includes('[role="dialog"]') ? ({} as Element) : null,
    } as unknown as EventTarget;
    expect(isBlockedDropTarget(target)).toBe(true);
  });

  test("does not block plain divs", () => {
    const target = {
      closest: () => null,
    } as unknown as EventTarget;
    expect(isBlockedDropTarget(target)).toBe(false);
  });

  test("returns false for null target", () => {
    expect(isBlockedDropTarget(null)).toBe(false);
  });
});

describe("capBatchForQueue", () => {
  const MAX = 5;

  test("accepts whole batch when under cap", () => {
    const files = [makeFile("a"), makeFile("b")];
    expect(capBatchForQueue(files, 0, MAX)).toEqual({
      accepted: files,
      rejectedCount: 0,
      totalAfter: 2,
    });
  });

  test("clips batch to remaining capacity", () => {
    const files = [makeFile("a"), makeFile("b"), makeFile("c"), makeFile("d")];
    const result = capBatchForQueue(files, 3, MAX);
    expect(result.accepted.map((f) => f.name)).toEqual(["a", "b"]);
    expect(result.rejectedCount).toBe(2);
    expect(result.totalAfter).toBe(MAX);
  });

  test("rejects everything when queue already at cap", () => {
    expect(capBatchForQueue([makeFile("a")], MAX, MAX)).toEqual({
      accepted: [],
      rejectedCount: 1,
      totalAfter: MAX,
    });
  });

  test("allows duplicate filenames without deduping", () => {
    const files = [makeFile("dup.png"), makeFile("dup.png")];
    const result = capBatchForQueue(files, 0, MAX);
    expect(result.accepted).toHaveLength(2);
  });
});

describe("summarizeBatchResults / formatPartialFailureMessage", () => {
  test("summarizes an all-success batch", () => {
    const summary = summarizeBatchResults([
      { file: "a", success: true, cardId: "1" },
      { file: "b", success: true, cardId: "2" },
    ]);
    expect(summary).toEqual({
      total: 2,
      successCount: 2,
      failures: [],
      firstFailure: undefined,
    });
  });

  test("produces partial failure copy per spec", () => {
    const summary = summarizeBatchResults([
      { file: "a", success: true, cardId: "1" },
      { file: "b", success: true, cardId: "2" },
      { file: "c", success: true, cardId: "3" },
      {
        file: "video.mov",
        success: false,
        error: "is too large",
      },
      {
        file: "doc.pdf",
        success: false,
        error: "Unsupported type",
      },
    ]);
    expect(summary.successCount).toBe(3);
    expect(summary.firstFailure?.file).toBe("video.mov");
    expect(formatPartialFailureMessage(summary)).toBe(
      "Uploaded 3 of 5 files. Couldn't upload: video.mov and doc.pdf."
    );
  });

  test("explains the server's validation failures in plain words, naming each file", () => {
    const summary = summarizeBatchResults([
      { file: "a.png", success: true, cardId: "1" },
      { file: "b.png", success: true, cardId: "2" },
      { file: "c.png", success: true, cardId: "3" },
      {
        file: "x-empty.txt",
        success: false,
        error: "fileSize must be a positive number",
        errorCode: "INVALID_INPUT",
      },
      {
        file: "notes.exe",
        success: false,
        error: "Unsupported file type",
        errorCode: "INVALID_INPUT",
      },
    ]);
    const message = formatPartialFailureMessage(summary);
    expect(message).toBe(
      "Uploaded 3 of 5 files. Empty file, nothing to save: x-empty.txt. Teak can't save this type of file: notes.exe."
    );
    expect(message).not.toContain("fileSize");
  });
});

describe("upload failures", () => {
  test.each([
    [{ error: "fileSize must be a positive number" }, "empty"],
    [{ error: "Unsupported file type" }, "unsupported"],
    [{ error: "anything", errorCode: "UNSUPPORTED_TYPE" }, "unsupported"],
    [{ error: "anything", errorCode: "FILE_TOO_LARGE" }, "tooLarge"],
    [{ error: "fileSize must not exceed 104857600 bytes" }, "tooLarge"],
    [
      { error: "File extension does not match the provided MIME type" },
      "mismatch",
    ],
    [{ error: "anything", errorCode: "TYPE_MISMATCH" }, "mismatch"],
    [{ error: "The upload stopped responding." }, "other"],
  ] as const)("reads %p as %p", (failure, kind) => {
    expect(uploadFailureKind(failure)).toBe(kind);
  });

  test("names up to three files, then says how many more", () => {
    expect(formatFileNames(["a.txt"])).toBe("a.txt");
    expect(formatFileNames(["a.txt", "b.txt"])).toBe("a.txt and b.txt");
    expect(formatFileNames(["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"])).toBe(
      "a.txt, b.txt, c.txt, and 2 more"
    );
  });

  test("groups files by what went wrong", () => {
    const empty = (file: string) => ({
      error: "fileSize must be a positive number",
      file,
      success: false as const,
    });
    expect(
      describeUploadFailures([
        empty("a.txt"),
        {
          error: "x",
          errorCode: "FILE_TOO_LARGE",
          file: "big.mov",
          success: false,
        },
        empty("b.txt"),
      ])
    ).toBe(
      "Empty files, nothing to save: a.txt and b.txt. Larger than 100 MB: big.mov."
    );
  });

  test("keeps an unknown reason when the files share it, and drops it otherwise", () => {
    expect(
      describeUploadFailures([
        { error: "Network down", file: "a.txt", success: false },
        { error: "Network down", file: "b.txt", success: false },
      ])
    ).toBe("a.txt and b.txt: Network down");
    expect(
      describeUploadFailures([
        { error: "Network down", file: "a.txt", success: false },
        { error: "Timed out", file: "b.txt", success: false },
      ])
    ).toBe("Couldn't upload: a.txt and b.txt.");
  });
});

describe("uploadAcceptAttribute", () => {
  const accepted = uploadAcceptAttribute().split(",");

  test("offers the formats Teak saves", () => {
    for (const entry of [
      ".png",
      ".pdf",
      ".mp3",
      ".webm",
      ".md",
      ".txt",
      ".js",
    ]) {
      expect(accepted).toContain(entry);
    }
    expect(accepted).toContain("image/png");
  });

  test("never offers every file", () => {
    expect(accepted).not.toContain("*/*");
    expect(accepted).not.toContain(".exe");
    expect(accepted).not.toContain("application/octet-stream");
    expect(new Set(accepted).size).toBe(accepted.length);
  });
});

describe("formatSkippedNote", () => {
  test("says how many files were skipped and what the limit is", () => {
    expect(formatSkippedNote(5, 20)).toBe(
      "5 files were skipped. You can upload up to 20 at a time."
    );
    expect(formatSkippedNote(1, 20)).toBe(
      "1 file was skipped. You can upload up to 20 at a time."
    );
  });

  test("is empty when nothing was skipped", () => {
    expect(formatSkippedNote(0, 20)).toBe("");
  });
});
