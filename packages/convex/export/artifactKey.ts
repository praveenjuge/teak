import { buildR2ExportPrefix, sha256Hex } from "../storage/r2Keys";

export const buildArtifactKey = async (
  userId: string,
  jobId: string,
  nowMs: number = Date.now()
): Promise<string> => {
  const hashUserId = (await sha256Hex(userId)).slice(0, 16);
  const stamp = new Date(nowMs).toISOString().slice(0, 10);
  return `${buildR2ExportPrefix()}${hashUserId}/${jobId}-${stamp}.zip`;
};

export const exportArtifactObjectKeys = (artifactKey: string): string[] => [
  artifactKey,
  `${artifactKey}.checkpoint.json`,
  `${artifactKey}.result.json`,
  `${artifactKey}.manifest.json`,
];
