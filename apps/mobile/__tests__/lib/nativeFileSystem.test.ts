import { beforeEach, describe, expect, mock, test } from "bun:test";

const infoMock = mock(() => ({ exists: true, size: 128 }));
const writeMock = mock(() => undefined);
const downloadFileAsyncMock = mock(
  async (_url: string, dest: { uri: string }) => ({
    uri: dest.uri,
  })
);
const uploadAsyncMock = mock(async () => ({
  body: "",
  headers: { etag: '"abc"' },
  status: 200,
}));
const cancelMock = mock(() => undefined);
const constructedFiles: unknown[][] = [];
const constructedTasks: { file: unknown; options: unknown; url: string }[] = [];

class MockFile {
  uri: string;
  constructor(...segments: unknown[]) {
    constructedFiles.push(segments);
    this.uri = `file:///mock/${constructedFiles.length}`;
  }
  info = (...args: unknown[]) => infoMock(...args);
  write = (...args: unknown[]) => writeMock(...args);
  static downloadFileAsync = (...args: unknown[]) =>
    downloadFileAsyncMock(...(args as [string, { uri: string }]));
}

class MockUploadTask {
  constructor(file: unknown, url: string, options: unknown) {
    constructedTasks.push({ file, options, url });
  }
  uploadAsync = (...args: unknown[]) => uploadAsyncMock(...args);
  cancel = (...args: unknown[]) => cancelMock(...args);
}

const mockCacheDir = { uri: "file:///cache/" };
const mockDocumentDir = { uri: "file:///documents/" };

mock.module("expo-file-system", () => ({
  File: MockFile,
  Paths: { cache: mockCacheDir, document: mockDocumentDir },
  UploadTask: MockUploadTask,
}));

const loadBoundary = () => import("../../lib/nativeFileSystem");

describe("nativeFileSystem", () => {
  beforeEach(() => {
    constructedFiles.length = 0;
    constructedTasks.length = 0;
    for (const fn of [
      infoMock,
      writeMock,
      downloadFileAsyncMock,
      uploadAsyncMock,
      cancelMock,
    ]) {
      fn.mockClear();
    }
    infoMock.mockImplementation(() => ({ exists: true, size: 128 }));
    downloadFileAsyncMock.mockImplementation(
      async (_url: string, dest: { uri: string }) => ({ uri: dest.uri })
    );
    uploadAsyncMock.mockImplementation(async () => ({
      body: "",
      headers: { etag: '"abc"' },
      status: 200,
    }));
  });

  test("getNativeFileSize returns the file size", async () => {
    const { getNativeFileSize } = await loadBoundary();

    expect(getNativeFileSize("file:///share/a.png")).toBe(128);
    expect(constructedFiles[0]).toEqual(["file:///share/a.png"]);
  });

  test("getNativeFileSize returns 0 for missing or sizeless files", async () => {
    const { getNativeFileSize } = await loadBoundary();
    infoMock.mockImplementationOnce(() => ({ exists: false }));
    infoMock.mockImplementationOnce(() => ({ exists: true }));

    expect(getNativeFileSize("file:///missing")).toBe(0);
    expect(getNativeFileSize("file:///nosize")).toBe(0);
  });

  test("uploadNativeFileBinary PUTs the file with content type and signal", async () => {
    const { uploadNativeFileBinary } = await loadBoundary();
    const controller = new AbortController();

    const result = await uploadNativeFileBinary({
      contentType: "image/png",
      fileUri: "file:///share/a.png",
      signal: controller.signal,
      uploadUrl: "https://uploads.example.com/put",
    });

    expect(result).toEqual({
      headers: { etag: '"abc"' },
      ok: true,
      status: 200,
    });
    expect(constructedTasks).toHaveLength(1);
    expect(constructedTasks[0]?.url).toBe("https://uploads.example.com/put");
    expect(constructedTasks[0]?.options).toEqual({
      headers: { "Content-Type": "image/png" },
      httpMethod: "PUT",
      signal: controller.signal,
    });
    expect(constructedTasks[0]?.file).toBeInstanceOf(MockFile);
  });

  test("uploadNativeFileBinary maps non-2xx statuses to ok:false", async () => {
    const { uploadNativeFileBinary } = await loadBoundary();
    uploadAsyncMock.mockImplementationOnce(async () => ({
      body: "denied",
      headers: {},
      status: 403,
    }));

    const result = await uploadNativeFileBinary({
      contentType: "image/png",
      fileUri: "file:///share/a.png",
      signal: new AbortController().signal,
      uploadUrl: "https://uploads.example.com/put",
    });

    expect(result).toEqual({ headers: {}, ok: false, status: 403 });
  });

  test("uploadNativeFileBinary cancels and throws AbortError when pre-aborted", async () => {
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
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(uploadAsyncMock).not.toHaveBeenCalled();
  });

  test("uploadNativeFileBinary maps mid-upload aborts to AbortError", async () => {
    const { uploadNativeFileBinary } = await loadBoundary();
    const controller = new AbortController();
    uploadAsyncMock.mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new Error("native abort"));
    });

    const error = await uploadNativeFileBinary({
      contentType: "image/png",
      fileUri: "file:///share/a.png",
      signal: controller.signal,
      uploadUrl: "https://uploads.example.com/put",
    }).catch((e: Error) => e);

    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("Upload cancelled");
  });

  test("uploadNativeFileBinary rethrows non-abort failures", async () => {
    const { uploadNativeFileBinary } = await loadBoundary();
    uploadAsyncMock.mockImplementationOnce(() =>
      Promise.reject(new Error("connection reset"))
    );

    const error = await uploadNativeFileBinary({
      contentType: "image/png",
      fileUri: "file:///share/a.png",
      signal: new AbortController().signal,
      uploadUrl: "https://uploads.example.com/put",
    }).catch((e: Error) => e);

    expect(error.message).toBe("connection reset");
  });

  test("downloadNativeFileToCache overwrites idempotently and returns the uri", async () => {
    const { downloadNativeFileToCache } = await loadBoundary();

    const uri = await downloadNativeFileToCache(
      "https://files.example.com/a.png",
      "a.png"
    );

    expect(uri).toBe("file:///mock/1");
    expect(downloadFileAsyncMock).toHaveBeenCalledTimes(1);
    const [url, dest, options] = downloadFileAsyncMock.mock.calls[0] ?? [];
    expect(url).toBe("https://files.example.com/a.png");
    expect(dest).toBeInstanceOf(MockFile);
    expect(options).toEqual({ idempotent: true });
    expect(constructedFiles[0]).toEqual([mockCacheDir, "a.png"]);
  });

  test("downloadNativeFileToDocuments targets the document directory", async () => {
    const { downloadNativeFileToDocuments } = await loadBoundary();

    await downloadNativeFileToDocuments(
      "https://files.example.com/a.png",
      "a.png"
    );

    expect(constructedFiles[0]).toEqual([mockDocumentDir, "a.png"]);
    expect(downloadFileAsyncMock.mock.calls[0]?.[2]).toEqual({
      idempotent: true,
    });
  });

  test("writeNativeCacheText writes UTF-8 text and returns the uri", async () => {
    const { writeNativeCacheText } = await loadBoundary();

    const uri = writeNativeCacheText("note.txt", "hello");

    expect(uri).toBe("file:///mock/1");
    expect(constructedFiles[0]).toEqual([mockCacheDir, "note.txt"]);
    expect(writeMock).toHaveBeenCalledWith("hello");
  });
});
