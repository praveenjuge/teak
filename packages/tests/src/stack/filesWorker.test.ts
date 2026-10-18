import { describe, expect, test } from "bun:test";
import { slotPorts } from "../../../../scripts/worktree-env.ts";
import { filesWorkerOrigin } from "./config";
import { filesWorkerConfigs } from "./filesWorker";

describe("filesWorkerConfigs", () => {
  test("serves files from a host the API proxy leaves alone", () => {
    const ports = slotPorts(3);
    const { vars } = filesWorkerConfigs(ports).worker;
    expect(vars.API_PUBLIC_HOST).toBe("localhost");
    expect(new URL(filesWorkerOrigin(ports)).hostname).not.toBe(
      vars.API_PUBLIC_HOST
    );
  });
});
