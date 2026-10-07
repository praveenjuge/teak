// Convex CLI emits no stdout for a successful function returning null. The
// process exit status is checked by execFile before this parser is called.
export function parseConvexCliResponse(stdout: string): unknown {
  if (!stdout.trim()) {
    return null;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    // Captured responses can contain credentials; never include them in errors.
    throw new Error("Convex CLI returned invalid JSON");
  }
}
