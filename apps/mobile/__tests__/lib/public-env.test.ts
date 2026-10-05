import { afterEach, beforeEach, expect, test } from "bun:test";
import { getConvexSiteUrl, getConvexUrl } from "../../lib/public-env";

const originalUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const originalSite = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
const originalDevelopment = Object.getOwnPropertyDescriptor(
  globalThis,
  "__DEV__"
);
beforeEach(() => {
  Object.defineProperty(globalThis, "__DEV__", {
    value: false,
    configurable: true,
  });
});
afterEach(() => {
  for (const [key, value] of Object.entries({
    EXPO_PUBLIC_CONVEX_URL: originalUrl,
    EXPO_PUBLIC_CONVEX_SITE_URL: originalSite,
  })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  if (originalDevelopment) {
    Object.defineProperty(globalThis, "__DEV__", originalDevelopment);
  } else {
    Reflect.deleteProperty(globalThis, "__DEV__");
  }
});

test.each([
  "https://teak-demo.convex.cloud",
  "https://teak-demo.convex.cloud/",
])("accepts hosted Convex %s", (url) => {
  process.env.EXPO_PUBLIC_CONVEX_URL = url;
  expect(getConvexUrl()).toBe("https://teak-demo.convex.cloud");
});
test.each([
  "https://evil.example",
  "http://teak-demo.convex.cloud",
  "https://convex.cloud.evil.example",
  "https://user:pass@teak-demo.convex.cloud",
  "https://teak-demo.convex.cloud/path",
  "https://teak-demo.convex.cloud?token=value",
  "https://teak-demo.convex.cloud#secret",
  "https://teak-demo.convex.site",
  "https://teak-demo.convex.cloud:8443",
  "file:///tmp/test",
  "http://127.0.0.1:3210",
  "http://192.168.1.20:3210",
])("rejects unsafe production origin %s", (url) => {
  process.env.EXPO_PUBLIC_CONVEX_URL = url;
  expect(getConvexUrl).toThrow("Invalid EXPO_PUBLIC_CONVEX_URL");
});
test.each([
  "http://127.0.0.1:3210",
  "http://localhost:4500",
  "http://[::1]:3210",
  "http://192.168.1.20:3210",
  "http://10.0.2.2:3210",
  "http://172.16.0.2:3210",
])("accepts local development origin %s", (url) => {
  Object.defineProperty(globalThis, "__DEV__", {
    value: true,
    configurable: true,
  });
  process.env.EXPO_PUBLIC_CONVEX_URL = url;
  expect(getConvexUrl()).toBe(url);
});
test.each([
  "http://8.8.8.8:3210",
  "http://172.32.0.2:3210",
  "http://192.168.1.20.evil.example:3210",
  "http://localhost:3210/path",
  "ftp://127.0.0.1:3210",
])("development still rejects untrusted origin %s", (url) => {
  Object.defineProperty(globalThis, "__DEV__", {
    value: true,
    configurable: true,
  });
  process.env.EXPO_PUBLIC_CONVEX_URL = url;
  expect(getConvexUrl).toThrow();
});
test("site accessor admits only its hosted origin family", () => {
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://teak-demo.convex.site/";
  expect(getConvexSiteUrl()).toBe("https://teak-demo.convex.site");
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "https://evil.example";
  expect(getConvexSiteUrl).toThrow("Invalid EXPO_PUBLIC_CONVEX_SITE_URL");
});
