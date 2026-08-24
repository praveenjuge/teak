import {
  getUploadEtag,
  throwIfAborted,
  uploadWithTransientRetry,
} from "./fileUploadTransport.client";

export interface MultipartUploadDependencies {
  completeMultipartUpload: (args: {
    sessionId: string;
  }) => Promise<{ etag: string; size: number; uploadKey: string }>;
  prepareMultipartUpload: (args: {
    fileLastModified: number;
    fileName: string;
    fileSize: number;
    fileType: string;
  }) => Promise<MultipartUploadSession>;
  recordMultipartPart: (args: {
    etag: string;
    partNumber: number;
    sessionId: string;
    size: number;
  }) => Promise<unknown>;
}

interface MultipartUploadSession {
  partSize: number;
  partUrls: Array<{ partNumber: number; uploadUrl: string }>;
  sessionId: string;
  uploadedParts: number[];
  uploadKey: string;
}

export const uploadMultipartFile = async ({
  dependencies,
  file,
  fileType,
  onProgress,
  signal,
}: {
  dependencies: MultipartUploadDependencies;
  file: File;
  fileType: string;
  onProgress: (progress: number) => void;
  signal: AbortSignal;
}): Promise<{ etag: string; uploadKey: string }> => {
  const session = await dependencies.prepareMultipartUpload({
    fileLastModified: file.lastModified,
    fileName: file.name,
    fileSize: file.size,
    fileType,
  });
  for (const [index, part] of session.partUrls.entries()) {
    throwIfAborted(signal);
    const start = (part.partNumber - 1) * session.partSize;
    const blob = file.slice(
      start,
      Math.min(start + session.partSize, file.size),
      fileType
    );
    const response = await uploadWithTransientRetry(
      () =>
        fetch(part.uploadUrl, {
          body: blob,
          headers: { "Content-Type": fileType },
          method: "PUT",
          signal,
        }),
      signal
    );
    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }
    const etag = getUploadEtag(response.headers);
    if (!etag) {
      throw new Error("Upload part ETag was unavailable");
    }
    await dependencies.recordMultipartPart({
      etag,
      partNumber: part.partNumber,
      sessionId: session.sessionId,
      size: blob.size,
    });
    onProgress(10 + Math.round(((index + 1) / session.partUrls.length) * 65));
  }
  const completed = await dependencies.completeMultipartUpload({
    sessionId: session.sessionId,
  });
  return { etag: completed.etag, uploadKey: completed.uploadKey };
};
