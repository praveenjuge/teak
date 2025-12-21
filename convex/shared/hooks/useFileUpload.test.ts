// @ts-nocheck
import { describe, expect, test, mock, beforeEach, spyOn } from "bun:test";

// Mock React
const mockSetState = mock();
mock.module("react", () => ({
  useState: (init: any) => [init, mockSetState],
  useCallback: (fn: any) => fn,
}));

// Mock fetch
const mockFetch = mock();
global.fetch = mockFetch;

// Mock DOM
global.window = {} as any;
global.document = {} as any;
global.URL = {
    createObjectURL: mock(() => "blob:url"),
    revokeObjectURL: mock(),
} as any;

class MockImage {
    onload: any;
    onerror: any;
    _src: string = "";
    width: number = 0;
    height: number = 0;
    naturalWidth: number = 0;
    naturalHeight: number = 0;

    set src(value: string) {
        this._src = value;
        // Simulate async load
        setTimeout(() => {
            if (value === "blob:url") {
                this.naturalWidth = 100;
                this.naturalHeight = 200;
                this.onload && this.onload();
            } else {
                this.onerror && this.onerror();
            }
        }, 10);
    }
}
global.Image = MockImage as any;

import { useFileUploadCore, setFileUploadSentryCaptureFunction, FileUploadDependencies } from "./useFileUpload";
import { MAX_FILE_SIZE, MAX_FILES_PER_UPLOAD, CARD_ERROR_CODES, CARD_ERROR_MESSAGES } from "../constants";

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

    describe("uploadFile", () => {
        test("validates file size", async () => {
             const file = { size: MAX_FILE_SIZE + 1, name: "large.png", type: "image/png" } as any;
             const result = await hook.uploadFile(file);
             expect(result.success).toBe(false);
             expect((result as any).errorCode).toBe(CARD_ERROR_CODES.FILE_TOO_LARGE);
        });

        test("validates file type", async () => {
             const file = { size: 100, name: "unknown.xyz", type: "application/unknown" } as any;
             const result = await hook.uploadFile(file);
             expect(result.success).toBe(false);
             expect((result as any).errorCode).toBe(CARD_ERROR_CODES.UNSUPPORTED_TYPE);
        });

        test("successful upload flow", async () => {
             const file = { size: 100, name: "test.png", type: "image/png" } as any;
             
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });

             const result = await hook.uploadFile(file);

             expect(mockUploadAndCreateCard).toHaveBeenCalled();
             expect(mockFetch).toHaveBeenCalledWith("https://upload", expect.any(Object));
             expect(mockFinalizeUploadedCard).toHaveBeenCalledWith(expect.objectContaining({ fileId: "store_1" }));
             expect(mockOnSuccess).toHaveBeenCalledWith("card_1");
             expect(result.success).toBe(true);
             expect((result as any).cardId).toBe("card_1");
        });

        test("handles upload preparation failure", async () => {
             const file = { size: 100, name: "test.png", type: "image/png" } as any;
             mockUploadAndCreateCard.mockResolvedValue({ success: false, error: "prep fail" });

             const result = await hook.uploadFile(file);
             expect(result.success).toBe(false);
             expect((result as any).error).toBe("prep fail");
        });

        test("handles fetch upload failure", async () => {
             const file = { size: 100, name: "test.png", type: "image/png" } as any;
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: false, status: 500 });

             const result = await hook.uploadFile(file);
             expect(result.success).toBe(false);
             expect((result as any).error).toContain("Upload failed with status 500");
        });

        test("handles finalize failure", async () => {
             const file = { size: 100, name: "test.png", type: "image/png" } as any;
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: false, error: "fin fail" });

             const result = await hook.uploadFile(file);
             expect(result.success).toBe(false);
             expect((result as any).error).toBe("fin fail");
        });

        test("preserves provided dimensions", async () => {
             const file = { size: 100, name: "test.png", type: "image/png" } as any;
             const metadata = { width: 50, height: 50 };
             
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });

             await hook.uploadFile(file, { additionalMetadata: metadata });
             
             expect(mockUploadAndCreateCard).toHaveBeenCalledWith(expect.objectContaining({
                 additionalMetadata: metadata
             }));
        });

        test("extracts image dimensions", async () => {
             const file = { size: 100, name: "test.png", type: "image/png" } as any;
             
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });

             // Wait for async image load simulation
             await hook.uploadFile(file);
             
             expect(mockUploadAndCreateCard).toHaveBeenCalledWith(expect.objectContaining({
                 additionalMetadata: { width: 100, height: 200 }
             }));
        });

        test("supports video type", async () => {
             const file = { size: 100, name: "test.mp4", type: "video/mp4" } as any;
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });
             await hook.uploadFile(file);
             expect(mockUploadAndCreateCard).toHaveBeenCalledWith(expect.objectContaining({ cardType: "video" }));
        });

        test("supports audio type", async () => {
             const file = { size: 100, name: "test.mp3", type: "audio/mp3" } as any;
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });
             await hook.uploadFile(file);
             expect(mockUploadAndCreateCard).toHaveBeenCalledWith(expect.objectContaining({ cardType: "audio" }));
        });

        test("supports document type (pdf)", async () => {
             const file = { size: 100, name: "test.pdf", type: "application/pdf" } as any;
             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });
             await hook.uploadFile(file);
             expect(mockUploadAndCreateCard).toHaveBeenCalledWith(expect.objectContaining({ cardType: "document" }));
        });
        test("handles image load failure", async () => {
             const file = { size: 100, name: "test.png", type: "image/png" } as any;
             
             // Mock createObjectURL to return something triggering onerror in MockImage
             (global.URL.createObjectURL as any).mockReturnValueOnce("blob:fail");

             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });

             await hook.uploadFile(file);
             
             // Should proceed without dimensions
             expect(mockUploadAndCreateCard).toHaveBeenCalledWith(expect.objectContaining({
                 additionalMetadata: undefined
             }));
        });
    });

    describe("uploadMultipleFiles", () => {
        test("validates file count", async () => {
             const files = Array(MAX_FILES_PER_UPLOAD + 1).fill({ size: 100, name: "test.png", type: "image/png" }) as any;
             const results = await hook.uploadMultipleFiles(files);
             expect(results[0].success).toBe(false);
             expect(results[0].errorCode).toBe(CARD_ERROR_CODES.TOO_MANY_FILES);
        });

        test("uploads files sequentially", async () => {
             const files = [
                 { size: 100, name: "1.png", type: "image/png" },
                 { size: 100, name: "2.png", type: "image/png" }
             ] as any;

             mockUploadAndCreateCard.mockResolvedValue({ success: true, uploadUrl: "https://upload" });
             mockFetch.mockResolvedValue({ ok: true, json: async () => ({ storageId: "store_1" }) });
             mockFinalizeUploadedCard.mockResolvedValue({ success: true, cardId: "card_1" });

             const results = await hook.uploadMultipleFiles(files);
             
             expect(results.length).toBe(2);
             expect(results[0].success).toBe(true);
             expect(results[1].success).toBe(true);
             expect(mockUploadAndCreateCard).toHaveBeenCalledTimes(2);
        });
    });
});
