import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { findMissingKeys, isPortOccupied } from "./doctor.ts";

describe("findMissingKeys", () => {
  test("reports keys absent from dotenv content", () => {
    const content = "# comment\nNEXT_PUBLIC_CONVEX_URL=http://x\n";
    expect(
      findMissingKeys(content, [
        "NEXT_PUBLIC_CONVEX_URL",
        "NEXT_PUBLIC_CONVEX_SITE_URL",
      ])
    ).toEqual(["NEXT_PUBLIC_CONVEX_SITE_URL"]);
  });

  test("empty when all keys present", () => {
    const content = "A=1\nB=2\n";
    expect(findMissingKeys(content, ["A", "B"])).toEqual([]);
  });
});

describe("isPortOccupied", () => {
  test("detects a bound port and a free port", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);
    expect(await isPortOccupied(port)).toBe(true);
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    expect(await isPortOccupied(port)).toBe(false);
  });
});
