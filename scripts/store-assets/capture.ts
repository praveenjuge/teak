/**
 * Captures one raw screenshot from a running app into its store's source
 * folder. Put the app on the right screen first, then run:
 *
 *   bun scripts/store-assets/capture.ts prepare iphone|android
 *   bun scripts/store-assets/capture.ts iphone 01-library [--as-is]
 *   bun scripts/store-assets/capture.ts android 01-library
 *   bun scripts/store-assets/capture.ts mac 01-library [--app Safari --window "<title>"]
 *
 * `prepare` sets a clean status bar (9:41, full signal and battery, no
 * notifications). iPhone captures use `asc screenshots capture`; Mac
 * captures a window by ID in the background; Android uses adb. TEAK_STORE_SIMULATOR picks a simulator (name or UDID,
 * default "iPhone 17 Pro Max"); ANDROID_HOME locates adb.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { STORES, type StoreId } from "./shots.ts";

const root = path.resolve(import.meta.dir, "../..");
const IPHONE_BUNDLE = "com.praveenjuge.teak";
const MAC_APP = "Teak for Mac";

const run = async (cmd: string[], stdout: "pipe" | "inherit" = "pipe") => {
  const proc = Bun.spawn(cmd, { stdout, stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    stdout === "pipe" ? new Response(proc.stdout).arrayBuffer() : null,
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${cmd[0]} ${cmd[1]} failed: ${err.trim()}`);
  }
  return Buffer.from(out ?? new ArrayBuffer(0));
};

const simulatorUdid = async (): Promise<string> => {
  const wanted = process.env.TEAK_STORE_SIMULATOR ?? "iPhone 17 Pro Max";
  const list = JSON.parse(
    (
      await run(["xcrun", "simctl", "list", "devices", "booted", "-j"])
    ).toString()
  ) as { devices: Record<string, { name: string; udid: string }[]> };
  const device = Object.values(list.devices)
    .flat()
    .find((d) => d.udid === wanted || d.name === wanted);
  if (!device) {
    throw new Error(`Boot the "${wanted}" simulator first.`);
  }
  return device.udid;
};

const adb = () =>
  process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, "platform-tools/adb")
    : "adb";

const demo = (command: string, extras: Record<string, string> = {}) => [
  adb(),
  "shell",
  "am",
  "broadcast",
  "-a",
  "com.android.systemui.demo",
  "-e",
  "command",
  command,
  ...Object.entries(extras).flatMap(([k, v]) => ["-e", k, v]),
];

const prepare = async (store: StoreId) => {
  if (store === "iphone") {
    const udid = await simulatorUdid();
    // A 12-hour clock shows "9:41" rather than "09:41". It applies after the
    // simulator restarts, so the first prepare reboots it.
    const defaults = ["xcrun", "simctl", "spawn", udid, "defaults"];
    const global = (await run([...defaults, "read", "-g"])).toString();
    if (
      /AppleICUForce24HourTime = 1/.test(global) ||
      !/AppleICUForce12HourTime = 1/.test(global)
    ) {
      await run([
        ...defaults,
        "write",
        "-g",
        "AppleICUForce12HourTime",
        "-bool",
        "true",
      ]);
      await run([
        ...defaults,
        "write",
        "-g",
        "AppleICUForce24HourTime",
        "-bool",
        "false",
      ]);
      await run(["xcrun", "simctl", "shutdown", udid]);
      await run(["xcrun", "simctl", "boot", udid]);
      await run(["xcrun", "simctl", "bootstatus", udid]);
    }
    await run([
      "xcrun",
      "simctl",
      "status_bar",
      udid,
      "override",
      "--time",
      "9:41",
      "--dataNetwork",
      "wifi",
      "--wifiMode",
      "active",
      "--wifiBars",
      "3",
      "--cellularMode",
      "active",
      "--cellularBars",
      "4",
      "--batteryState",
      "discharging",
      "--batteryLevel",
      "100",
    ]);
  } else if (store === "android") {
    await run([
      adb(),
      "shell",
      "settings",
      "put",
      "global",
      "sysui_demo_allowed",
      "1",
    ]);
    await run(demo("enter"));
    // SystemUI drops commands sent before it finishes entering demo mode.
    await Bun.sleep(500);
    for (const step of [
      demo("clock", { hhmm: "0941" }),
      demo("battery", { level: "100", plugged: "false" }),
      demo("network", { wifi: "show", level: "4", fully: "true" }),
      demo("network", { mobile: "hide" }),
      demo("notifications", { visible: "false" }),
    ]) {
      await run(step);
    }
  } else {
    throw new Error("Only iphone and android need preparing.");
  }
  console.log(`Clean status bar set for ${store}.`);
};

/** The window to capture: `--window "<title>"` of `--app "<owner>"`. */
const macWindow = async (): Promise<number> => {
  const flag = (name: string, fallback: string) => {
    const index = process.argv.indexOf(name);
    return index > 0 ? (process.argv[index + 1] ?? fallback) : fallback;
  };
  const owner = flag("--app", MAC_APP);
  const title = flag("--window", "Teak Library");
  const script = `ObjC.import("CoreGraphics"); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0))).filter((w) => w.kCGWindowOwnerName === ${JSON.stringify(owner)} && w.kCGWindowName === ${JSON.stringify(title)}).map((w) => w.kCGWindowNumber))`;
  const ids = JSON.parse(
    (await run(["osascript", "-l", "JavaScript", "-e", script])).toString()
  ) as number[];
  if (!ids[0]) {
    throw new Error(`Open the "${title}" window of ${owner} first.`);
  }
  return ids[0];
};

const capture = async (store: StoreId, name: string) => {
  const dir = path.join(root, STORES[store].sourceDir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  if (store === "android") {
    writeFileSync(file, await run([adb(), "exec-out", "screencap", "-p"]));
  } else if (store === "mac") {
    // asc's macOS capture needs the window in front of everything; capturing
    // by window ID works in the background, even on another Space.
    const id = await macWindow();
    await run(["screencapture", "-x", "-o", `-l${id}`, file]);
  } else if (process.argv.includes("--as-is")) {
    // asc brings Teak to the front first, which closes a share sheet or any
    // other app's screen; this takes the screen exactly as it is.
    await run([
      "xcrun",
      "simctl",
      "io",
      await simulatorUdid(),
      "screenshot",
      file,
    ]);
  } else {
    const receipt = JSON.parse(
      (
        await run([
          "asc",
          "screenshots",
          "capture",
          "--bundle-id",
          IPHONE_BUNDLE,
          "--name",
          name,
          "--output-dir",
          dir,
          "--udid",
          await simulatorUdid(),
        ])
      ).toString()
    ) as { path: string };
    if (path.resolve(receipt.path) !== file) {
      renameSync(receipt.path, file);
    }
  }
  console.log(`Captured ${path.relative(root, file)}`);
};

const [first, second] = process.argv.slice(2);
if (first === "prepare") {
  await prepare(second as StoreId);
} else if (first && first in STORES && second) {
  await capture(first as StoreId, second);
} else {
  console.error(
    "Usage: capture.ts prepare <iphone|android> | <mac|iphone|android> <name>"
  );
  process.exit(1);
}
