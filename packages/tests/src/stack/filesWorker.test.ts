import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

  test("reads the getting-started files through the Worker, as deployed", () => {
    const { assets } = filesWorkerConfigs(slotPorts(3)).worker;
    expect(assets).toMatchObject({ binding: "ASSETS", run_worker_first: true });
    expect(
      existsSync(join(assets.directory, "onboarding/coral-lily.webp"))
    ).toBe(true);
  });
});
