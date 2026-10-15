export interface JobContext {
  /** Epoch milliseconds when the job's wall clock runs out. */
  deadline: number;
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
