import { File, Paths, UploadTask } from "expo-file-system";

export interface NativeUploadResult {
  headers: Record<string, string>;
  ok: boolean;
  status: number;
}

export interface NativeBinaryUpload {
  contentType: string;
  fileUri: string;
  signal: AbortSignal;
  uploadUrl: string;
}

export const createUploadAbortError = () => {
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
};

/** File size in bytes, or 0 when the file is missing or unreadable. */
export function getNativeFileSize(fileUri: string): number {
  const info = new File(fileUri).info();
  return info.exists && typeof info.size === "number" ? info.size : 0;
}

export async function uploadNativeFileBinary({
  fileUri,
  uploadUrl,
  contentType,
  signal,
}: NativeBinaryUpload): Promise<NativeUploadResult> {
  const task = new UploadTask(new File(fileUri), uploadUrl, {
    headers: { "Content-Type": contentType },
    httpMethod: "PUT",
    signal,
  });

  if (signal.aborted) {
    task.cancel();
    throw createUploadAbortError();
  }

  let result: Awaited<ReturnType<UploadTask["uploadAsync"]>>;
  try {
    result = await task.uploadAsync();
  } catch (error) {
    if (signal.aborted) {
      throw createUploadAbortError();
    }
    throw error;
  }

  if (signal.aborted) {
    throw createUploadAbortError();
  }

  return {
    headers: result.headers,
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
  };
}

export async function downloadNativeFileToCache(
  url: string,
  fileName: string
): Promise<string> {
  const file = await File.downloadFileAsync(
    url,
    new File(Paths.cache, fileName),
    { idempotent: true }
  );
  return file.uri;
}

export async function downloadNativeFileToDocuments(
  url: string,
  fileName: string
): Promise<string> {
  const file = await File.downloadFileAsync(
    url,
    new File(Paths.document, fileName),
    { idempotent: true }
  );
  return file.uri;
}

export function writeNativeCacheText(fileName: string, value: string): string {
  const file = new File(Paths.cache, fileName);
  file.write(value);
  return file.uri;
}
