import {
  buildFileSigningPayload,
  nowInSeconds,
  type SignatureCheck,
  verifySignature,
} from "@teak/files-protocol";

export type ParsedRange =
  | { kind: "offset"; offset: number; length?: number }
  | { kind: "suffix"; suffix: number };

/**
 * Parse a single-range `Range` header into an R2 get() range option.
 * Multi-range, non-bytes, and malformed headers are ignored (the caller serves
 * the full object), which RFC 9110 permits. Returns null when the header is
 * absent.
 */
export const parseSingleByteRange = (
  rangeHeader: string | null | undefined
): ParsedRange | null => {
  if (!rangeHeader) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") {
    return null;
  }
  if (rawStart === "") {
    const suffix = Number.parseInt(rawEnd ?? "", 10);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return null;
    }
    return { kind: "suffix", suffix };
  }
  const start = Number.parseInt(rawStart ?? "", 10);
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > Number.MAX_SAFE_INTEGER - 1
  ) {
    return null;
  }
  if (rawEnd === "") {
    return { kind: "offset", offset: start };
  }
  const end = Number.parseInt(rawEnd ?? "", 10);
  if (!Number.isSafeInteger(end) || end < start) {
    return null;
  }
  return { kind: "offset", offset: start, length: end - start + 1 };
};

export interface SignedFileRequestParams {
  cd?: string | null | undefined;
  ct?: string | null | undefined;
  exp: string | null | undefined;
  key: string;
  sig: string | null | undefined;
}

/** A signed file link: no upper bound on its expiry, unlike requests. */
export const verifySignedFileRequest = (
  secret: string,
  { key, exp, sig, ct, cd }: SignedFileRequestParams,
  nowSeconds = nowInSeconds()
): Promise<SignatureCheck> =>
  verifySignature(
    secret,
    {
      expiresAt: key ? exp : null,
      maxTtlSeconds: null,
      payload: (expiresAt) =>
        buildFileSigningPayload({
          key,
          exp: expiresAt,
          contentType: ct ?? "",
          contentDisposition: cd ?? "",
        }),
      signature: sig,
    },
    nowSeconds
  );
