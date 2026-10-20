import { expect, test } from "bun:test";
import { launchFile, reversePorts } from "../scripts/e2e-session";

const session = (convexUrl: string, emulatorOrigin: string) =>
  ({
    email: "e2e-android@example.org",
    response: { access_token: "a", user: { id: "user_1" } },
    urls: { appOrigin: "http://localhost:4600", convexUrl, emulatorOrigin },
  }) as unknown as Parameters<typeof launchFile>[0];

test("points the app only at a stack on this machine", () => {
  const file = launchFile(
    session("http://127.0.0.1:4610", "http://localhost:4620")
  );
  expect(file.convexUrl).toBe("http://127.0.0.1:4610");
  expect(JSON.parse(Buffer.from(file.session, "base64").toString())).toEqual({
    access_token: "a",
    user: { id: "user_1" },
  });
  expect(() =>
    launchFile(session("https://example.convex.cloud", "http://localhost:4620"))
  ).toThrow("The E2E emulator must run on this machine");
});

test("reverses the ports the app talks to", () => {
  expect(
    reversePorts({
      convex: 4610,
      convexSite: 4611,
      emulator: 4620,
      docs: 4601,
      namespace: "wt-6",
    })
  ).toEqual([4610, 4611, 4620]);
});
