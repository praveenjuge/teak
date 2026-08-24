// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useFileUploadCore } from "../../../client/hooks/useFileUpload.client";
import { MAX_FILE_SIZE } from "../../../shared/constants";
import {
  mockFetch,
  mockSetState,
  mockUseEffectCleanups,
} from "./useFileUpload.testSupport";

describe("file upload initialization and multipart flow", () => {
  const uploadAndCreateCard = mock();
  const finalizeUploadedCard = mock();

  beforeEach(() => {
    global.fetch = mockFetch;
    uploadAndCreateCard.mockReset();
    finalizeUploadedCard.mockReset();
    mockFetch.mockReset();
    mockSetState.mockReset();
    mockUseEffectCleanups.length = 0;
  });

  test("exposes initialized upload state and methods", () => {
    const hook = useFileUploadCore({
      finalizeUploadedCard,
      uploadAndCreateCard,
    });
    expect(typeof hook.uploadFile).toBe("function");
    expect(typeof hook.uploadMultipleFiles).toBe("function");
    expect(typeof hook.uploadFileFromUri).toBe("function");
    expect(hook.state).toMatchObject({ isUploading: false, progress: 0 });
    expect(hook.error).toBeNull();
  });

  test("uses default error capture without throwing", async () => {
    const hook = useFileUploadCore({} as any);
    const result = await hook.uploadFile({
      name: "a.png",
      size: MAX_FILE_SIZE + 1,
      type: "image/png",
    } as any);
    expect(result.success).toBe(false);
  });

  test("uploads large files as recorded resumable parts", async () => {
    const prepareMultipartUpload = mock(async () => ({
      partSize: 8 * 1024 * 1024,
      partUrls: [
        { partNumber: 1, uploadUrl: "https://upload/1" },
        { partNumber: 2, uploadUrl: "https://upload/2" },
      ],
      sessionId: "session-1",
      uploadedParts: [],
      uploadKey: "pending-large",
    }));
    const recordMultipartPart = mock(async () => null);
    const completeMultipartUpload = mock(async () => ({
      etag: '"complete-etag"',
      size: 9 * 1024 * 1024,
      uploadKey: "pending-large",
    }));
    const hook = useFileUploadCore({
      completeMultipartUpload,
      finalizeUploadedCard,
      prepareMultipartUpload,
      recordMultipartPart,
      uploadAndCreateCard,
    });
    const file = new File([new Uint8Array(9 * 1024 * 1024)], "large.png", {
      lastModified: 123,
      type: "image/png",
    });
    mockFetch
      .mockResolvedValueOnce({
        headers: new Headers({ ETag: "etag-1" }),
        ok: true,
        status: 204,
      })
      .mockResolvedValueOnce({
        headers: new Headers({ ETag: "etag-2" }),
        ok: true,
        status: 204,
      });
    finalizeUploadedCard.mockResolvedValue({
      cardId: "card-large",
      success: true,
    });

    expect(await hook.uploadFile(file)).toEqual({
      cardId: "card-large",
      success: true,
    });
    expect(uploadAndCreateCard).not.toHaveBeenCalled();
    expect(recordMultipartPart).toHaveBeenCalledTimes(2);
    expect(completeMultipartUpload).toHaveBeenCalledWith({
      sessionId: "session-1",
    });
    expect(finalizeUploadedCard).toHaveBeenCalledWith(
      expect.objectContaining({
        fileEtag: '"complete-etag"',
        fileKey: "pending-large",
      })
    );
  });

  test("resumes by uploading and recording only missing parts", async () => {
    const prepareMultipartUpload = mock(async () => ({
      partSize: 8 * 1024 * 1024,
      partUrls: [{ partNumber: 2, uploadUrl: "https://upload/2" }],
      sessionId: "session-resumed",
      uploadedParts: [1],
      uploadKey: "pending-resumed",
    }));
    const recordMultipartPart = mock(async () => null);
    const completeMultipartUpload = mock(async () => ({
      etag: '"resumed-etag"',
      size: 9 * 1024 * 1024,
      uploadKey: "pending-resumed",
    }));
    const hook = useFileUploadCore({
      completeMultipartUpload,
      finalizeUploadedCard,
      prepareMultipartUpload,
      recordMultipartPart,
      uploadAndCreateCard,
    });
    const file = new File([new Uint8Array(9 * 1024 * 1024)], "resume.pdf", {
      lastModified: 456,
      type: "application/pdf",
    });
    mockFetch.mockResolvedValue({
      headers: new Headers({ ETag: "etag-2" }),
      ok: true,
      status: 204,
    });
    finalizeUploadedCard.mockResolvedValue({
      cardId: "card-resumed",
      success: true,
    });

    expect(await hook.uploadFile(file)).toEqual({
      cardId: "card-resumed",
      success: true,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(recordMultipartPart).toHaveBeenCalledWith({
      etag: "etag-2",
      partNumber: 2,
      sessionId: "session-resumed",
      size: 1024 * 1024,
    });
    expect(completeMultipartUpload).toHaveBeenCalledWith({
      sessionId: "session-resumed",
    });
  });
});
