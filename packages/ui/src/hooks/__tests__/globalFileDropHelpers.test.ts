// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetQueueItemIdCounter,
  capBatchForQueue,
  createQueueItemId,
  dataTransferHasFiles,
  extractFilesFromDataTransfer,
  formatPartialFailureMessage,
  isBlockedDropTarget,
  isDataTransferItemFolder,
  summarizeBatchResults,
} from "../globalFileDropHelpers";

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

describe("createQueueItemId", () => {
  beforeEach(() => {
    _resetQueueItemIdCounter();
  });

  test("generates unique ids for same filename dropped twice", () => {
    const a = createQueueItemId();
    const b = createQueueItemId();
    expect(a).not.toEqual(b);
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
      "Uploaded 3 of 5 files. First failure: video.mov — is too large"
    );
  });
});
