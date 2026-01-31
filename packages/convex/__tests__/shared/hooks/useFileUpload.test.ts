// @ts-nocheck
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

// Mock React
const mockSetState = mock();
mock.module("react", () => ({
  useState: (init: any) => [init, mockSetState],
  useCallback: (fn: any) => fn,
}));

// Mock fetch
const originalFetch = global.fetch;
const mockFetch = mock();

// Mock DOM
const originalImage = global.Image;
const originalURL = global.URL;

beforeAll(() => {
  global.fetch = mockFetch;
  global.window = {} as any;
  global.document = {} as any;
  global.URL = {
    createObjectURL: mock(() => "blob:url"),
    revokeObjectURL: mock(),
  } as any;
  global.Image = MockImage as any;
});

afterAll(() => {
  global.fetch = originalFetch;
  global.Image = originalImage;
  global.URL = originalURL;
});

class MockImage {
  onload: any;
  onerror: any;
  _src = "";
  width = 0;
  height = 0;
  naturalWidth = 0;
  naturalHeight = 0;

  set src(value: string) {
    this._src = value;
    // Simulate async load
    setTimeout(() => {
      if (value === "blob:url") {
        this.naturalWidth = 100;
        this.naturalHeight = 200;
        this.onload?.();
      } else {
        this.onerror?.();
      }
    }, 10);
  }
}
global.Image = MockImage as any;

import {
  type FileUploadDependencies,
  setFileUploadSentryCaptureFunction,
  useFileUploadCore,
} from "../../../client/hooks/useFileUpload.client";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
} from "../../../shared/constants";

describe("defaults", () => {
  test("uses default sentry capture without error", async () => {
    const hook = useFileUploadCore({} as any);
    try {
      // 1MB + 1 byte
      await hook.uploadFile({
        size: MAX_FILE_SIZE + 1,
        name: "a.png",
        type: "image/png",
      } as any);
    } catch (_e) {
      // expected error return, or the hook catches it and returns success:false
    }
  });
});

describe("useFileUploadCore", () => {
  const mockUploadAndCreateCard = mock();
  const mockFinalizeUploadedCard = mock();
  const mockOnSuccess = mock();
  const mockOnError = mock();
  const mockOnProgress = mock();
  const mockSentryCapture = mock();

  const dependencies: FileUploadDependencies = {
    uploadAndCreateCard: mockUploadAndCreateCard,
    finalizeUploadedCard: mockFinalizeUploadedCard,
  };
  const config = {
    onSuccess: mockOnSuccess,
    onError: mockOnError,
    onProgress: mockOnProgress,
  };

  beforeEach(() => {
    mockUploadAndCreateCard.mockReset();
    mockFinalizeUploadedCard.mockReset();
    mockOnSuccess.mockReset();
    mockOnError.mockReset();
    mockOnProgress.mockReset();
    mockSetState.mockReset();
    mockFetch.mockReset();
    mockSentryCapture.mockReset();
    setFileUploadSentryCaptureFunction(mockSentryCapture);
  });

  const hook = useFileUploadCore(dependencies, config);

  describe("initialization", () => {
    test("creates hook with uploadFile method", () => {
      expect(typeof hook.uploadFile).toBe("function");
    });

    test("creates hook with uploadMultipleFiles method", () => {
      expect(typeof hook.uploadMultipleFiles).toBe("function");
    });

    test("creates hook with state object", () => {
      expect(hook.state).toBeDefined();
      expect(typeof hook.state.isUploading).toBe("boolean");
      expect(typeof hook.state.progress).toBe("number");
      // error is FileUploadError | null
      expect(
        hook.state.error === null || typeof hook.state.error === "object"
      ).toBe(true);
    });

    test("creates hook with convenience getters", () => {
      expect(typeof hook.isUploading).toBe("boolean");
      expect(typeof hook.progress).toBe("number");
      // error is string | null (error.message)
      expect(hook.error === null || typeof hook.error === "string").toBe(true);
    });

    test("initial state is not uploading", () => {
      expect(hook.isUploading).toBe(false);
    });

    test("initial progress is 0", () => {
      expect(hook.progress).toBe(0);
    });

    test("initial error is null", () => {
      expect(hook.error).toBeNull();
    });
  });

  describe("uploadFile - validation", () => {
    test("validates file size exceeds limit", async () => {
      const file = {
        size: MAX_FILE_SIZE + 1,
        name: "large.png",
        type: "image/png",
      } as any;
      const result = await hook.uploadFile(file);
      expect(result.success).toBe(false);
      expect((result as any).errorCode).toBe(CARD_ERROR_CODES.FILE_TOO_LARGE);
    });

    test("returns correct error message for oversized file", async () => {
      const file = {
        size: MAX_FILE_SIZE + 1,
        name: "large.png",
        type: "image/png",
      } as any;
      const result = await hook.uploadFile(file);
      expect((result as any).error).toBe(CARD_ERROR_MESSAGES.FILE_TOO_LARGE);
    });

    test("validates unsupported file type", async () => {
      const file = {
        size: 100,
        name: "unknown.xyz",
        type: "application/unknown",
      } as any;
      const result = await hook.uploadFile(file);
      expect(result.success).toBe(false);
      expect((result as any).errorCode).toBe(CARD_ERROR_CODES.UNSUPPORTED_TYPE);
    });

    test("rejects files without mime type", async () => {
      const file = { size: 100, name: "notype", type: undefined } as any;
      const result = await hook.uploadFile(file);
      expect(result.success).toBe(false);
    });
  });

  describe("uploadFile - successful flow", () => {
    test("completes full upload successfully for image", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      const result = await hook.uploadFile(file);

      expect(mockUploadAndCreateCard).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://upload",
        expect.any(Object)
      );
      expect(mockFinalizeUploadedCard).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: "store_1" })
      );
      expect(mockOnSuccess).toHaveBeenCalledWith("card_1");
      expect(result.success).toBe(true);
      expect((result as any).cardId).toBe("card_1");
    });

    test("calls onProgress callback at 25%", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      await hook.uploadFile(file);

      expect(mockOnProgress).toHaveBeenCalledWith(25);
    });

    test("calls onProgress callback at 75%", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      await hook.uploadFile(file);

      expect(mockOnProgress).toHaveBeenCalledWith(75);
    });

    test("calls onProgress callback at 100%", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      await hook.uploadFile(file);

      expect(mockOnProgress).toHaveBeenCalledWith(100);
    });
  });

  describe("uploadFile - error handling", () => {
    test("handles upload preparation failure", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: false,
        error: "prep fail",
      });

      const result = await hook.uploadFile(file);
      expect(result.success).toBe(false);
      expect((result as any).error).toBe("prep fail");
    });

    test("handles fetch upload failure", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await hook.uploadFile(file);
      expect(result.success).toBe(false);
      expect((result as any).error).toContain("Upload failed with status 500");
    });

    test("handles finalize failure", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: false,
        error: "fin fail",
      });

      const result = await hook.uploadFile(file);
      expect(result.success).toBe(false);
      expect((result as any).error).toBe("fin fail");
    });

    test("calls onError callback on failure", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: false,
        error: "test error",
      });

      await hook.uploadFile(file);

      expect(mockOnError).toHaveBeenCalledWith({
        message: "test error",
        code: undefined,
      });
    });

    test("captures exception in Sentry on failure", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: false,
        error: "test error",
      });

      await hook.uploadFile(file);

      expect(mockSentryCapture).toHaveBeenCalled();
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[1].tags).toEqual({
        source: "convex",
        operation: "fileUpload",
      });
    });
  });

  describe("uploadFile - metadata handling", () => {
    test("preserves provided dimensions", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;
      const metadata = { width: 50, height: 50 };

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      await hook.uploadFile(file, { additionalMetadata: metadata });

      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalMetadata: metadata,
        })
      );
    });

    test("extracts image dimensions when not provided", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      // Wait for async image load simulation
      await hook.uploadFile(file);

      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalMetadata: { width: 100, height: 200 },
        })
      );
    });

    test("handles image load failure gracefully", async () => {
      const file = { size: 100, name: "test.png", type: "image/png" } as any;

      // Mock createObjectURL to return something triggering onerror in MockImage
      (global.URL.createObjectURL as any).mockReturnValueOnce("blob:fail");

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      await hook.uploadFile(file);

      // Should proceed without dimensions
      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalMetadata: undefined,
        })
      );
    });
  });

  describe("uploadFile - file type inference", () => {
    test("supports video type", async () => {
      const file = { size: 100, name: "test.mp4", type: "video/mp4" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });
      await hook.uploadFile(file);
      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: "video" })
      );
    });

    test("supports audio type", async () => {
      const file = { size: 100, name: "test.mp3", type: "audio/mp3" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });
      await hook.uploadFile(file);
      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: "audio" })
      );
    });

    test("supports document type (pdf)", async () => {
      const file = {
        size: 100,
        name: "test.pdf",
        type: "application/pdf",
      } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });
      await hook.uploadFile(file);
      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: "document" })
      );
    });

    test("supports document type (word)", async () => {
      const file = {
        size: 100,
        name: "test.doc",
        type: "application/msword",
      } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });
      await hook.uploadFile(file);
      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: "document" })
      );
    });

    test("supports text files", async () => {
      const file = { size: 100, name: "test.txt", type: "text/plain" } as any;
      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });
      await hook.uploadFile(file);
      expect(mockUploadAndCreateCard).toHaveBeenCalledWith(
        expect.objectContaining({ cardType: "document" })
      );
    });
  });

  describe("uploadMultipleFiles", () => {
    test("validates file count exceeds limit", async () => {
      const files = new Array(MAX_FILES_PER_UPLOAD + 1).fill({
        size: 100,
        name: "test.png",
        type: "image/png",
      }) as any;
      const results = await hook.uploadMultipleFiles(files);
      expect(results[0].success).toBe(false);
      expect(results[0].errorCode).toBe(CARD_ERROR_CODES.TOO_MANY_FILES);
    });

    test("uploads multiple files sequentially", async () => {
      const files = [
        { size: 100, name: "1.png", type: "image/png" },
        { size: 100, name: "2.png", type: "image/png" },
      ] as any;

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      const results = await hook.uploadMultipleFiles(files);

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockUploadAndCreateCard).toHaveBeenCalledTimes(2);
    });

    test("returns file names in results", async () => {
      const files = [
        { size: 100, name: "file1.png", type: "image/png" },
        { size: 100, name: "file2.png", type: "image/png" },
      ] as any;

      mockUploadAndCreateCard.mockResolvedValue({
        success: true,
        uploadUrl: "https://upload",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      const results = await hook.uploadMultipleFiles(files);

      expect(results[0].file).toBe("file1.png");
      expect(results[1].file).toBe("file2.png");
    });

    test("handles partial failures in batch upload", async () => {
      const files = [
        { size: 100, name: "1.png", type: "image/png" },
        { size: 100, name: "2.png", type: "image/png" },
      ] as any;

      mockUploadAndCreateCard
        .mockResolvedValueOnce({ success: true, uploadUrl: "https://upload" })
        .mockResolvedValueOnce({ success: false, error: "failed" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "store_1" }),
      });
      mockFinalizeUploadedCard.mockResolvedValue({
        success: true,
        cardId: "card_1",
      });

      const results = await hook.uploadMultipleFiles(files);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });
});
