import { describe, expect, test } from "bun:test";
import { slotPorts, stackPorts } from "../../../../scripts/worktree-env.ts";
import { filesWorkerOrigin, stackUrls } from "./config";

describe("stack ports", () => {
  test("every origin the E2E stack serves is on a port its slot reserves", () => {
    const ports = slotPorts(3);
    const reserved = stackPorts(ports);
    const origins = [
      ...Object.values(stackUrls(ports)),
      filesWorkerOrigin(ports),
    ];
    for (const origin of origins) {
      expect(reserved).toContain(Number(new URL(origin).port));
    }
  });
});
