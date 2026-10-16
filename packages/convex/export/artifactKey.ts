import { buildR2ExportPrefix } from "../storage/r2Keys";

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

/**
 * Where a job's archive is written: under the top-level exports prefix, by a
 * hash of the owner (never the raw ID) and the job, stamped with the day.
 */
export const buildArtifactKey = async (
  userId: string,
  jobId: string,
  nowMs: number = Date.now()
): Promise<string> => {
  const hashUserId = (await sha256Hex(userId)).slice(0, 16);
  const stamp = new Date(nowMs).toISOString().slice(0, 10);
  return `${buildR2ExportPrefix()}${hashUserId}/${jobId}-${stamp}.zip`;
};

/** The archive and every sidecar the Files Worker writes next to it. */
export const exportArtifactObjectKeys = (artifactKey: string): string[] => [
  artifactKey,
  `${artifactKey}.checkpoint.json`,
  `${artifactKey}.result.json`,
  `${artifactKey}.manifest.json`,
];
