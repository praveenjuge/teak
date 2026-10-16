import {
  buildUploadSigningPayload,
  FILES_OBJECT_KEY_ROOTS,
  FILES_PROTOCOL_VERSION,
  FILES_UPLOAD_MAX_BYTES,
  FILES_UPLOAD_MAX_TTL_SECONDS,
  type FilesErrorCode,
} from "@teak/files-protocol";
import { ObjectWriteBlockedError } from "./deletionGate";
import { verifyHmacPayload } from "./lib";

const MAX_CONTENT_TYPE_LENGTH = 255;

export interface UploadEnv {
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
}

export const uploadError = (
  requestId: string,
  code: FilesErrorCode,
  message: string,
  status: number
): Response => {
  const response = Response.json(
    {
      error: { code, message, requestId, retryable: false },
      ok: false,
      version: FILES_PROTOCOL_VERSION,
    },
    { status, headers: { "cache-control": "no-store" } }
  );
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Expose-Headers", "Content-Length, ETag");
  return response;
};

export const isValidUploadKey = (key: string): boolean =>
  FILES_OBJECT_KEY_ROOTS.some((root) => key.startsWith(root)) &&
  !key.includes("\0") &&
  !key.split("/").includes("..") &&
  !key.includes("//") &&
  key.length <= 1024;

const isValidContentType = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_CONTENT_TYPE_LENGTH &&
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+(?:\s*;.*)?$/u.test(
    value
  );

export const handleSignedUpload = async (
  request: Request,
  env: UploadEnv,
  url: URL
): Promise<Response> => {
  const requestId =
    request.headers.get("x-teak-request-id") ?? crypto.randomUUID();

  const encodedKey = url.pathname.replace(/^\/__upload\/v1\//u, "");
  let key = "";
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    return uploadError(requestId, "INVALID_INPUT", "Invalid object key", 400);
  }
  const expiresAt = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  const contentType = url.searchParams.get("ct") ?? "";
  const boundSize = url.searchParams.get("sz");

  if (!(key && isValidUploadKey(key))) {
    return uploadError(requestId, "INVALID_INPUT", "Invalid object key", 400);
  }
  if (!(expiresAt && signature)) {
    return uploadError(
      requestId,
      "AUTH_INVALID",
      "Request authentication failed",
      401
    );
  }
  const contentTypeValue =
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  const boundContentType = url.searchParams.has("ct");
  const effectiveContentType = boundContentType
    ? contentType || contentTypeValue
    : contentTypeValue;
  if (!isValidContentType(effectiveContentType)) {
    return uploadError(
      requestId,
      "INVALID_INPUT",
      "A valid Content-Type is required",
      400
    );
  }

  const expiry = Number.parseInt(expiresAt, 10);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiry) ||
    String(expiry) !== expiresAt ||
    expiry > now + FILES_UPLOAD_MAX_TTL_SECONDS
  ) {
    return uploadError(
      requestId,
      "AUTH_INVALID",
      "Request authentication failed",
      403
    );
  }
  if (expiry < now) {
    return uploadError(
      requestId,
      "AUTH_EXPIRED",
      "Request authentication failed",
      410
    );
  }
  if (
    !(await verifyHmacPayload(
      env.FILES_SIGNING_SECRET,
      buildUploadSigningPayload({
        contentType: boundContentType ? effectiveContentType : "",
        expiresAt,
        key,
        size:
          boundSize !== null && boundSize !== ""
            ? Number.parseInt(boundSize, 10)
            : null,
      }),
      signature
    ))
  ) {
    return uploadError(
      requestId,
      "AUTH_INVALID",
      "Request authentication failed",
      403
    );
  }

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = Number.parseInt(contentLengthHeader ?? "", 10);
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
  if (
    boundSize !== null &&
    boundSize !== "" &&
    Number.parseInt(boundSize, 10) !== contentLength
  ) {
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
      httpMetadata: { contentType: effectiveContentType },
    });
    const response = Response.json(
      {
        data: { etag: stored.httpEtag, key, size: contentLength },
        ok: true,
        requestId,
        version: FILES_PROTOCOL_VERSION,
      },
      { headers: { "cache-control": "no-store" } }
    );
    response.headers.set("ETag", stored.httpEtag);
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set(
      "Access-Control-Expose-Headers",
      "Content-Length, ETag"
    );
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
    console.error("[files-worker] upload failed", {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
    return uploadError(requestId, "INTERNAL", "Upload failed", 500);
  }
};
