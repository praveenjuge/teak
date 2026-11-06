import {
  FILES_UPLOAD_MAX_BYTES,
  type FilesErrorCode,
  filesErrorEnvelope,
  filesSuccessEnvelope,
  SIGNED_REQUEST_HEADERS,
  verifyUploadUrl,
} from "@teak/files-protocol";
import { ObjectWriteBlockedError } from "../deletionGate";

export interface UploadEnv {
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
}

const signedUploadResponse = (body: unknown, status = 200): Response => {
  const response = Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Expose-Headers", "Content-Length, ETag");
  return response;
};

export const uploadError = (
  requestId: string,
  code: FilesErrorCode,
  message: string,
  status: number
): Response =>
  signedUploadResponse(
    filesErrorEnvelope({ code, message, requestId }),
    status
  );

export const handleSignedUpload = async (
  request: Request,
  env: UploadEnv,
  url: URL
): Promise<Response> => {
  const requestId =
    request.headers.get(SIGNED_REQUEST_HEADERS.requestId) ??
    crypto.randomUUID();
  const upload = await verifyUploadUrl(
    env.FILES_SIGNING_SECRET,
    url,
    request.headers.get("content-type")
  );
  if (!upload.ok) {
    return uploadError(requestId, upload.code, upload.message, upload.status);
  }
  const { contentType, key, size: boundSize } = upload;

  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10
  );
  if (!(request.body && Number.isSafeInteger(contentLength))) {
    return uploadError(
      requestId,
      "INVALID_INPUT",
      "Content-Length is required",
      411
    );
  }
  if (contentLength <= 0 || contentLength > FILES_UPLOAD_MAX_BYTES) {
    return uploadError(
      requestId,
      "PAYLOAD_TOO_LARGE",
      "Uploaded file size is invalid",
      413
    );
  }
  if (boundSize !== null && boundSize !== contentLength) {
    return uploadError(
      requestId,
      "CONFLICT",
      "Uploaded file size does not match the signed size",
      409
    );
  }

  try {
    // Pass the original fixed-length stream straight to R2; wrapping it would
    // drop the runtime's known-length metadata and break direct uploads.
    const stored = await env.BUCKET.put(key, request.body, {
      httpMetadata: { contentType },
    });
    const response = signedUploadResponse(
      filesSuccessEnvelope(requestId, {
        etag: stored.httpEtag,
        key,
        size: contentLength,
      })
    );
    response.headers.set("ETag", stored.httpEtag);
    return response;
  } catch (error) {
    if (error instanceof ObjectWriteBlockedError) {
      return uploadError(
        requestId,
        "CONFLICT",
        "Object writes are blocked",
        409
      );
    }
    console.error("[core-worker] upload failed", {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
    return uploadError(requestId, "INTERNAL", "Upload failed", 500);
  }
};
