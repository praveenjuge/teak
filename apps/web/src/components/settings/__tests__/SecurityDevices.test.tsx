import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import de from "@teak/i18n/messages/de.json";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { createTeakTranslator } = await import("@teak/i18n");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SecurityConnections, deviceName, orderDeviceSessions } = await import(
  "../SecurityConnections"
);
type DeviceSession = import("../SecurityConnections").DeviceSession;

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const sessions: DeviceSession[] = [
  {
    id: "session_OLD",
    name: "Chrome on Linux",
    agent: { kind: "browser", browser: "chrome", os: "linux" },
    current: false,
    signedInAt: Date.UTC(2026, 9, 1, 9),
  },
  {
    id: "session_HERE",
    name: "Firefox on macOS",
    agent: { kind: "browser", browser: "firefox", os: "macos" },
    current: true,
    signedInAt: Date.UTC(2026, 9, 2, 9),
    lastActiveAt: Date.UTC(2026, 9, 30, 9),
  },
  {
    id: "session_EXT",
    name: "Teak browser extension",
    agent: { kind: "extension" },
    current: false,
    signedInAt: Date.UTC(2026, 9, 3, 9),
  },
];

async function render(
  onRevokeOtherSessions = mock(() =>
    Promise.resolve({ hasMore: false, revokedCount: 2 })
  )
) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <SecurityConnections
        onLoadMoreSessions={() => undefined}
        onRevokeConnection={() => Promise.resolve()}
        onRevokeOtherSessions={onRevokeOtherSessions}
        onRevokeSession={() => Promise.resolve()}
        sessions={sessions}
        sessionsHasMore={false}
        sessionsLoadingMore={false}
      />
    )
  );
  return { container, onRevokeOtherSessions };
}

const click = (element: Element | undefined | null) =>
  act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });

const buttonNamed = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === name
  );

describe("devices in Settings → Security", () => {
  test("this device comes first in a labeled list, named in parts", async () => {
    const { container } = await render();
    const list = container.querySelector('ul[aria-label="Devices"]');
    const names = [...(list?.querySelectorAll("li") ?? [])].map(
      (row) => row.querySelector("p")?.textContent
    );
    expect(names).toEqual([
      "Firefox on macOS",
      "Chrome on Linux",
      "Teak browser extension",
    ]);
    expect(list?.querySelector("li")?.textContent).toContain("This device");
    expect(list?.querySelector("li")?.textContent).toContain("Last active");
  });

  test("signs out the other devices after asking", async () => {
    const { onRevokeOtherSessions } = await render();
    await click(buttonNamed("Sign out other devices"));
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Sign out all other devices?");
    expect(dialog?.textContent).toContain("This device stays signed in.");
    expect(onRevokeOtherSessions).not.toHaveBeenCalled();
    await click(
      [...(dialog?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Sign out other devices"
      )
    );
    expect(onRevokeOtherSessions).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Signed out 2 other devices."
    );
  });

  test("no sign-out-others button when this is the only device", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(() =>
      root?.render(
        <SecurityConnections
          onLoadMoreSessions={() => undefined}
          onRevokeConnection={() => Promise.resolve()}
          onRevokeOtherSessions={() =>
            Promise.resolve({ hasMore: false, revokedCount: 0 })
          }
          onRevokeSession={() => Promise.resolve()}
          sessions={sessions.filter((session) => session.current)}
          sessionsHasMore={false}
          sessionsLoadingMore={false}
        />
      )
    );
    expect(buttonNamed("Sign out other devices")).toBeUndefined();
  });
});

describe("deviceName", () => {
  const t = createTeakTranslator("de", de as never, "settings.connections");

  test("words the server's parts in the UI's language", () => {
    expect(
      deviceName({ name: "Chrome on Linux", agent: sessions[0]?.agent }, t)
    ).toBe("Chrome unter Linux");
    expect(deviceName({ name: "x", agent: { kind: "extension" } }, t)).toBe(
      "Teak-Browsererweiterung"
    );
    expect(deviceName({ name: "x", agent: { kind: "unknown" } }, t)).toBe(
      "Unbekanntes Gerät"
    );
    expect(
      deviceName({ name: "x", agent: { kind: "browser", os: "windows" } }, t)
    ).toBe("Browser unter Windows");
  });

  test("an older server's English name shows as it is", () => {
    expect(deviceName({ name: "Chrome on Linux" }, t)).toBe("Chrome on Linux");
  });

  test("orders this device first and keeps the rest in order", () => {
    expect(orderDeviceSessions(sessions).map((session) => session.id)).toEqual([
      "session_HERE",
      "session_OLD",
      "session_EXT",
    ]);
  });
});
