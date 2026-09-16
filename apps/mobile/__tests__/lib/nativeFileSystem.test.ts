import { beforeEach, describe, expect, mock, test } from "bun:test";
import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";

/**
 * Workflow coverage for the mobile native filesystem boundary: uploads,
 * cancellation, downloads, text sharing, and incoming-share imports.
 *
 * Instead of asserting mock-construction internals, these tests drive the
 * public functions against a fake `expo-file-system` with observable state
 * (stored files, recorded upload/download requests) and assert on results
 * plus effects: returned URIs, response mapping, error shapes, and which
 * directory each artifact lands in.
 */

interface FakeStoredFile {
  content: string;
  size: number;
}

interface RecordedUpload {
  cancelled: boolean;
  completed: boolean;
  headers: Record<string, string>;
  method: string;
  sourceUri: string;
  url: string;
}

interface RecordedDownload {
  destUri: string;
  idempotent: boolean;
  url: string;
}

const CACHE_URI = "file:///cache/";
const DOCUMENTS_URI = "file:///documents/";

const fileStore = new Map<string, FakeStoredFile>();
const recordedUploads: RecordedUpload[] = [];
const recordedDownloads: RecordedDownload[] = [];
const downloadBytes = new Map<string, string>();
let uploadHandler: () => Promise<{
  body: string;
  headers: Record<string, string>;
  status: number;
}>;
let downloadHandler: ((url: string) => Promise<void>) | null = null;

const defaultUploadHandler = async () => ({
  body: "",
  headers: { etag: '"abc"' },
  status: 200,
});

const joinUri = (...segments: Array<string | { uri: string }>): string =>
  segments
    .map((segment) => (typeof segment === "string" ? segment : segment.uri))
    .map((part, index, parts) => {
      if (index === 0) {
        return part.replace(/\/+$/, "");
      }
      if (index === parts.length - 1) {
        return part.replace(/^\/+/, "");
      }
      return part.replace(/^\/+|\/+$/g, "");
    })
    .join("/");

const readFakeFile = (uri: string): FakeStoredFile | null =>
  fileStore.get(uri) ?? null;

class FakeFile {
  uri: string;
  constructor(...segments: Array<string | { uri: string }>) {
    this.uri = joinUri(...segments);
  }
  info = () => {
    const stored = fileStore.get(this.uri);
    return stored
      ? { exists: true as const, size: stored.size }
      : { exists: false as const };
  };
  write = (value: string) => {
    fileStore.set(this.uri, {
      content: value,
      size: new TextEncoder().encode(value).length,
    });
  };
  static downloadFileAsync = async (
    url: string,
    dest: FakeFile,
    options?: { idempotent?: boolean }
  ) => {
    recordedDownloads.push({
      destUri: dest.uri,
      idempotent: options?.idempotent === true,
      url,
    });
    if (downloadHandler) {
      await downloadHandler(url);
    }
    const content = downloadBytes.get(url) ?? "";
    fileStore.set(dest.uri, {
      content,
      size: new TextEncoder().encode(content).length,
    });
    return dest;
  };
}

class FakeUploadTask {
  private readonly record: RecordedUpload;
  private readonly signal: AbortSignal | undefined;
  constructor(
    file: FakeFile,
    url: string,
    options: {
      headers?: Record<string, string>;
      httpMethod?: string;
      signal?: AbortSignal;
    }
  ) {
    this.signal = options.signal;
    this.record = {
      cancelled: false,
      completed: false,
      headers: options.headers ?? {},
      method: options.httpMethod ?? "POST",
      sourceUri: file.uri,
      url,
    };
    recordedUploads.push(this.record);
  }
  uploadAsync = async () => {
    if (this.signal?.aborted) {
      throw new Error("native upload aborted");
    }
    const result = await uploadHandler();
    this.record.completed = true;
    return result;
  };
  cancel = () => {
    this.record.cancelled = true;
  };
}

mock.module("expo-file-system", () => ({
  File: FakeFile,
  Paths: { cache: { uri: CACHE_URI }, document: { uri: DOCUMENTS_URI } },
  UploadTask: FakeUploadTask,
}));

const loadBoundary = () => import("../../lib/nativeFileSystem");
const loadShareImport = () => import("../../lib/share/uploadFileFromUri");

describe("nativeFileSystem workflows", () => {
  beforeEach(() => {
    fileStore.clear();
    recordedUploads.length = 0;
    recordedDownloads.length = 0;
    downloadBytes.clear();
    downloadHandler = null;
    uploadHandler = defaultUploadHandler;
  });

  describe("upload workflow", () => {
    test("PUTs the file bytes and returns the ok result", async () => {
      const { uploadNativeFileBinary } = await loadBoundary();

      const result = await uploadNativeFileBinary({
        contentType: "image/png",
        fileUri: "file:///share/a.png",
        signal: new AbortController().signal,
        uploadUrl: "https://uploads.example.com/put",
      });

      expect(result).toEqual({
        headers: { etag: '"abc"' },
        ok: true,
        status: 200,
      });
      expect(recordedUploads).toHaveLength(1);
      expect(recordedUploads[0]).toMatchObject({
        cancelled: false,
        completed: true,
        headers: { "Content-Type": "image/png" },
        method: "PUT",
        sourceUri: "file:///share/a.png",
        url: "https://uploads.example.com/put",
      });
    });

    test("maps non-2xx statuses to ok:false with the status passed through", async () => {
      const { uploadNativeFileBinary } = await loadBoundary();
      uploadHandler = async () => ({
        body: "denied",
        headers: {},
        status: 403,
      });

      const result = await uploadNativeFileBinary({
        contentType: "image/png",
        fileUri: "file:///share/a.png",
        signal: new AbortController().signal,
        uploadUrl: "https://uploads.example.com/put",
      });

      expect(result).toEqual({ headers: {}, ok: false, status: 403 });
      expect(recordedUploads[0]?.completed).toBe(true);
    });
  });

  describe("upload cancellation", () => {
    test("pre-aborted uploads throw AbortError without attempting the upload", async () => {
      const { uploadNativeFileBinary } = await loadBoundary();
      const controller = new AbortController();
      controller.abort();

      const error = await uploadNativeFileBinary({
        contentType: "image/png",
        fileUri: "file:///share/a.png",
        signal: controller.signal,
        uploadUrl: "https://uploads.example.com/put",
      }).catch((e: Error) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("AbortError");
      expect(recordedUploads).toHaveLength(1);
      expect(recordedUploads[0]?.cancelled).toBe(true);
      expect(recordedUploads[0]?.completed).toBe(false);
    });

    test("mid-upload aborts surface as AbortError", async () => {
      const { uploadNativeFileBinary } = await loadBoundary();
      const controller = new AbortController();
      uploadHandler = () => {
        controller.abort();
        return Promise.reject(new Error("native abort"));
      };

      const error = await uploadNativeFileBinary({
        contentType: "image/png",
        fileUri: "file:///share/a.png",
        signal: controller.signal,
        uploadUrl: "https://uploads.example.com/put",
      }).catch((e: Error) => e);

      expect(error.name).toBe("AbortError");
      expect(error.message).toBe("Upload cancelled");
    });

    test("an abort landing after completion still cancels the result", async () => {
      const { uploadNativeFileBinary } = await loadBoundary();
      const controller = new AbortController();
      uploadHandler = () => {
        controller.abort();
        return Promise.resolve({ body: "", headers: {}, status: 200 });
      };

      const error = await uploadNativeFileBinary({
        contentType: "image/png",
        fileUri: "file:///share/a.png",
        signal: controller.signal,
        uploadUrl: "https://uploads.example.com/put",
      }).catch((e: Error) => e);

      expect(error.name).toBe("AbortError");
    });

    test("non-abort failures rethrow unchanged", async () => {
      const { uploadNativeFileBinary } = await loadBoundary();
      uploadHandler = () => Promise.reject(new Error("connection reset"));

      const error = await uploadNativeFileBinary({
        contentType: "image/png",
        fileUri: "file:///share/a.png",
        signal: new AbortController().signal,
        uploadUrl: "https://uploads.example.com/put",
      }).catch((e: Error) => e);

      expect(error.message).toBe("connection reset");
    });
  });

  describe("download workflow", () => {
    test("downloads into the cache directory for share flows", async () => {
      const { downloadNativeFile } = await loadBoundary();

      const uri = await downloadNativeFile(
        "https://files.example.com/a.png",
        "a.png",
        "cache"
      );

      expect(uri).toBe("file:///cache/a.png");
      expect(recordedDownloads).toEqual([
        {
          destUri: "file:///cache/a.png",
          idempotent: true,
          url: "https://files.example.com/a.png",
        },
      ]);
      expect(readFakeFile(uri)?.content).toBe("");
    });

    test("downloads into the documents directory for saved files", async () => {
      const { downloadNativeFile } = await loadBoundary();

      const uri = await downloadNativeFile(
        "https://files.example.com/a.png",
        "a.png",
        "documents"
      );

      expect(uri).toBe("file:///documents/a.png");
      expect(recordedDownloads[0]?.destUri).toBe("file:///documents/a.png");
    });

    test("repeat downloads overwrite the same uri idempotently", async () => {
      const { downloadNativeFile } = await loadBoundary();
      downloadBytes.set("https://files.example.com/a.png", "v1");

      const first = await downloadNativeFile(
        "https://files.example.com/a.png",
        "a.png",
        "cache"
      );
      downloadBytes.set("https://files.example.com/a.png", "v2");
      const second = await downloadNativeFile(
        "https://files.example.com/a.png",
        "a.png",
        "cache"
      );

      expect(first).toBe(second);
      expect(readFakeFile(second)?.content).toBe("v2");
      expect(recordedDownloads).toHaveLength(2);
    });

    test("download failures propagate to the caller", async () => {
      const { downloadNativeFile } = await loadBoundary();
      downloadHandler = () => Promise.reject(new Error("network down"));

      const error = await downloadNativeFile(
        "https://files.example.com/a.png",
        "a.png",
        "cache"
      ).catch((e: Error) => e);

      expect(error.message).toBe("network down");
      expect(readFakeFile("file:///cache/a.png")).toBeNull();
    });
  });

  describe("text sharing workflow", () => {
    test("written text lands in cache and reads back verbatim", async () => {
      const { writeNativeCacheText } = await loadBoundary();

      const uri = writeNativeCacheText("note.txt", "hello share");

      expect(uri).toBe("file:///cache/note.txt");
      const stored = readFakeFile(uri);
      expect(stored?.content).toBe("hello share");
      expect(stored?.size).toBe("hello share".length);
    });
  });

  describe("file size workflow", () => {
    test("returns the stored size, or 0 for missing files", async () => {
      const { getNativeFileSize, writeNativeCacheText } = await loadBoundary();

      writeNativeCacheText("sized.txt", "12345");

      expect(getNativeFileSize("file:///cache/sized.txt")).toBe(5);
      expect(getNativeFileSize("file:///cache/missing.txt")).toBe(0);
    });
  });

  describe("incoming-share import workflow", () => {
    const shareParams = {
      content: "shared photo",
      fileName: "shared-photo.jpg",
      fileUri: "file:///share/incoming.jpg",
      mimeType: "image/jpeg",
    };

    test("rejects unsupported file types without calling upload", async () => {
      const { uploadFileFromUri } = await loadShareImport();
      const uploadFromUri = mock(async () => ({
        success: true as const,
        cardId: "card_1",
      }));

      const result = await uploadFileFromUri(
        {
          ...shareParams,
          fileName: "archive.zzz9",
          mimeType: "application/x-unknown",
        },
        { uploadFromUri }
      );

      expect(result).toEqual({
        success: false,
        error: "Unsupported file type",
        errorCode: CARD_ERROR_CODES.UNSUPPORTED_TYPE,
      });
      expect(uploadFromUri).not.toHaveBeenCalled();
    });

    test("resolves a missing size from the device file", async () => {
      const { uploadFileFromUri } = await loadShareImport();
      const { writeNativeCacheText } = await loadBoundary();
      writeNativeCacheText("incoming-copy.jpg", "fake-bytes");
      const uploadFromUri = mock(async () => ({
        success: true as const,
        cardId: "card_1",
      }));

      const result = await uploadFileFromUri(
        { ...shareParams, fileUri: "file:///cache/incoming-copy.jpg" },
        { uploadFromUri }
      );

      expect(result).toEqual({ success: true, cardId: "card_1" });
      expect(uploadFromUri).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "shared-photo.jpg",
          size: "fake-bytes".length,
          type: "image/jpeg",
          uri: "file:///cache/incoming-copy.jpg",
        })
      );
    });

    test("prefers a provided size over reading the device file", async () => {
      const { uploadFileFromUri } = await loadShareImport();
      const uploadFromUri = mock(async () => ({
        success: true as const,
        cardId: "card_1",
      }));

      await uploadFileFromUri(
        { ...shareParams, fileSize: 4096 },
        { uploadFromUri }
      );

      expect(uploadFromUri).toHaveBeenCalledWith(
        expect.objectContaining({ size: 4096 })
      );
    });

    test("fails cleanly when the shared file is unreadable", async () => {
      const { uploadFileFromUri } = await loadShareImport();
      const uploadFromUri = mock(async () => ({
        success: true as const,
        cardId: "card_1",
      }));

      const result = await uploadFileFromUri(
        { ...shareParams, fileUri: "file:///share/gone.jpg" },
        { uploadFromUri }
      );

      expect(result).toEqual({
        success: false,
        error: "Unable to read shared file size.",
      });
      expect(uploadFromUri).not.toHaveBeenCalled();
    });

    test("normalizes unexpected upload dependency failures", async () => {
      const { uploadFileFromUri } = await loadShareImport();
      const uploadFromUri = mock(() =>
        Promise.reject(new Error("network timeout"))
      );

      const result = await uploadFileFromUri(
        { ...shareParams, fileSize: 128 },
        { uploadFromUri }
      );

      expect(result).toEqual({ success: false, error: "network timeout" });
    });

    test("passes dependency results through untouched", async () => {
      const { uploadFileFromUri } = await loadShareImport();
      const uploadFromUri = mock(async () => ({
        success: false as const,
        error: "quota exceeded",
      }));

      const result = await uploadFileFromUri(
        { ...shareParams, fileSize: 128 },
        { uploadFromUri }
      );

      expect(result).toEqual({ success: false, error: "quota exceeded" });
    });
  });
});
