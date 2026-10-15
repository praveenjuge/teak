export const SAMPLES_PER_WINDOW = 400;

export class PeakWindows {
  readonly windows: number[] = [];
  private carry: number | null = null;
  private current = 0;
  private filled = 0;

  push(chunk: Uint8Array): void {
    let offset = 0;
    if (this.carry !== null && chunk.byteLength > 0) {
      this.addSample(toInt16(this.carry, chunk[0]));
      this.carry = null;
      offset = 1;
    }
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (; offset + 1 < chunk.byteLength; offset += 2) {
      this.addSample(view.getInt16(offset, true));
    }
    if (offset < chunk.byteLength) {
      this.carry = chunk[offset];
    }
  }

  /** Closes the last partial window. Call once the stream ends. */
  finish(): number[] {
    if (this.filled > 0) {
      this.windows.push(this.current);
      this.current = 0;
      this.filled = 0;
    }
    return this.windows;
  }

  private addSample(sample: number): void {
    const magnitude = Math.abs(sample);
    if (magnitude > this.current) {
      this.current = magnitude;
    }
    this.filled++;
    if (this.filled === SAMPLES_PER_WINDOW) {
      this.windows.push(this.current);
      this.current = 0;
      this.filled = 0;
    }
  }
}

function toInt16(low: number, high: number): number {
  const value = low + high * 256;
  return value >= 32_768 ? value - 65_536 : value;
}

export function peaksFromWindows(windows: number[], count: number): number[] {
  let loudest = 0;
  for (const value of windows) {
    if (value > loudest) {
      loudest = value;
    }
  }
  if (loudest === 0) {
    return new Array<number>(count).fill(0);
  }
  const total = windows.length;
  const bars: number[] = [];
  for (let bar = 0; bar < count; bar++) {
    const start = Math.floor((bar * total) / count);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * total) / count));
    let peak = 0;
    for (let index = start; index < end; index++) {
      if (windows[index] > peak) {
        peak = windows[index];
      }
    }
    bars.push(Math.round(Math.sqrt(peak / loudest) * 100));
  }
  return bars;
}
