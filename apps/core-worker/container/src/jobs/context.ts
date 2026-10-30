export interface JobContext {
  deadlineEpochMs: number;
  dir: string;
  input: string;
}

export async function readOutput(path: string): Promise<Uint8Array | null> {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size === 0) {
    return null;
  }
  return await file.bytes();
}
