import { resolveMx } from "node:dns/promises";
import { Socket } from "node:net";
import {
  assertE2ECleanupReady,
  assertE2EProvisioningReady,
} from "../helpers/e2e-cleanup";
import {
  env,
  requireE2ECleanup,
  requireE2ENamespace,
  requireMailpit,
  requirePassword,
} from "../helpers/env";
import { assertMailpitReady } from "../helpers/mailpit";

const checkPort = (host: string, port: number) =>
  new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(5000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`${host}:${port} timed out`));
    });
    socket.connect(port, host);
  });

const main = async () => {
  requirePassword();
  requireE2ECleanup();
  requireE2ENamespace();
  await assertE2ECleanupReady();
  await assertE2EProvisioningReady();

  if (env.emailDeliveryEnabled) {
    requireMailpit();
    await assertMailpitReady();
    const mx = await resolveMx(env.emailDomain).catch(() => []);
    if (!mx.length) {
      throw new Error(`No MX records found for ${env.emailDomain}`);
    }

    mx.sort((a, b) => a.priority - b.priority);
    await checkPort(mx[0].exchange, 25);

    console.log(
      `Production E2E preflight ok: provisioning=direct email=${env.emailDomain} -> ${mx[0].exchange}:25`
    );
    return;
  }
  console.log("Production E2E preflight ok: provisioning=direct email=skipped");
};

main().catch((error) => {
  console.error(
    `Production E2E preflight failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
