// @ts-nocheck
import { afterAll, beforeAll, mock } from "bun:test";

export const mockSetState = mock();
export const mockUseEffectCleanups: Array<() => void> = [];
export const mockFetch = mock();

mock.module("react", () => ({
  useState: (init: any) => [init, mockSetState],
  useCallback: (fn: any) => fn,
  useEffect: (fn: any) => {
    const cleanup = fn();
    if (typeof cleanup === "function") {
      mockUseEffectCleanups.push(cleanup);
    }
  },
  useRef: (init: any) => ({ current: init }),
}));

const originalFetch = global.fetch;
const originalImage = global.Image;
const originalURL = global.URL;

class MockImage {
  onload: any;
  onerror: any;
  width = 0;
  height = 0;
  naturalWidth = 0;
  naturalHeight = 0;

  set src(value: string) {
    setTimeout(() => {
      if (value === "blob:url") {
        this.naturalWidth = 100;
        this.naturalHeight = 200;
        this.onload?.();
      } else {
        this.onerror?.();
      }
    }, 10);
  }
}

class MockVideo {
  muted = false;
  playsInline = false;
  preload = "";
  onloadedmetadata: any;
  onerror: any;
  videoWidth = 0;
  videoHeight = 0;

  set src(value: string) {
    setTimeout(() => {
      if (value === "blob:url") {
        this.videoWidth = 1280;
        this.videoHeight = 720;
        this.onloadedmetadata?.();
      } else {
        this.onerror?.();
      }
    }, 10);
  }
}

beforeAll(() => {
  global.fetch = mockFetch;
  global.window = {} as any;
  global.document = {
    createElement: (tag: string) => (tag === "video" ? new MockVideo() : {}),
  } as any;
  global.URL = {
    createObjectURL: mock(() => "blob:url"),
    revokeObjectURL: mock(),
  } as any;
  global.Image = MockImage as any;
});

afterAll(() => {
  global.fetch = originalFetch;
  global.Image = originalImage;
  global.URL = originalURL;
});
