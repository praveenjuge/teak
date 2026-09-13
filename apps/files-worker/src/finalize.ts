import {
  FILES_PROCESSOR_VERSION,
  type FilesFinalizeUploadResult,
} from "@teak/files-protocol";
import type { Env } from "./index";
import { optionalString, requiredString, sameUserNamespace } from "./ops";
import { verifyUploadBytes } from "./verify";

/**
 * Verified finalization: detect and verify the pending bytes against the
 * claimed file name and MIME type, then copy the object to its permanent
 * key. Nothing is stored until verification succeeds; the returned MIME,
 * dimensions, and facts are authoritative for Convex.
 */
export const finalizeUpload = async (
  env: Env,
  params: Record<string, unknown>
): Promise<FilesFinalizeUploadResult> => {
  const sourceKey = requiredString(params, "sourceKey");
  const destinationKey = requiredString(params, "destinationKey");
  const fileName = requiredString(params, "fileName");
  const expectedEtag = optionalString(params, "expectedEtag") ?? undefined;
  const expectedSize =
    typeof params.expectedSize === "number" &&
    Number.isSafeInteger(params.expectedSize)
      ? (params.expectedSize as number)
      : undefined;
  const requestedMimeType =
    optionalString(params, "requestedMimeType") ?? undefined;
  const readText = params.readText === true ? true : undefined;

  if (!sameUserNamespace(sourceKey, destinationKey)) {
    throw new Error("invalid_key_namespace");
  }

  const verified = await verifyUploadBytes({
    bucket: env.BUCKET,
    expectedEtag,
    expectedSize,
    fileName,
    readText,
    requestedMimeType,
    sourceKey,
  });

  const source = await env.BUCKET.get(sourceKey);
  if (!source) {
    throw new Error("source_not_found");
  }
  if (
    (expectedEtag && source.httpEtag !== expectedEtag) ||
    (expectedSize !== undefined && source.size !== expectedSize)
  ) {
    await source.body.cancel();
    throw new Error("source_changed");
  }
  const stored = await env.BUCKET.put(destinationKey, source.body, {
    customMetadata: {
      formatId: verified.format.id,
      processorVersion: FILES_PROCESSOR_VERSION,
      sourceEtag: source.httpEtag,
      verificationLevel: verified.verificationLevel,
    },
    httpMetadata: { contentType: verified.mimeType },
  });
  if (!stored) {
    throw new Error("finalize_failed");
  }
  if (stored.size !== undefined && source.size !== stored.size) {
    await env.BUCKET.delete(destinationKey);
    throw new Error("finalize_failed");
  }
  return {
    content: verified.content,
    destinationKey,
    facts: Object.keys(verified.facts).length > 0 ? verified.facts : undefined,
    formatId: verified.format.id,
    mimeType: verified.mimeType,
    processorVersion: FILES_PROCESSOR_VERSION,
    sourceEtag: source.httpEtag,
    storedEtag: stored.httpEtag,
    storedFileSize: source.size,
    storedMimeType: verified.mimeType,
    verificationLevel: verified.verificationLevel,
  };
};
