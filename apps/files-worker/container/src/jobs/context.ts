export interface JobContext {
  /** Epoch milliseconds when the job's wall clock runs out. */
  deadline: number;
  /** The job's private directory; every output lives here. */
  dir: string;
  /** The spooled source bytes. */
  input: string;
}

/** The file's bytes, or null when it is missing or empty. */
export async function readOutput(path: string): Promise<Uint8Array | null> {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size === 0) {
    return null;
  }
  return await file.bytes();
}
