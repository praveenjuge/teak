import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ApiKeysPanel, nextRevealedKeys } = await import("../ApiKeysPanel");
type ApiKeyListItem = import("../ApiKeysPanel").ApiKeyListItem;

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const listed = (id: string, prefix: string): ApiKeyListItem => ({
  createdAt: Date.UTC(2026, 9, 22),
  id,
  maskedKey: `teakapi_secret_live_${prefix}_••••••••`,
  name: "Default API key",
  status: "active",
});

function Fixture({
  onRevoke,
  onRevokeAll,
}: {
  onRevoke: (id: string) => void;
  onRevokeAll: () => void;
}) {
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  return (
    <ApiKeysPanel
      isLoading={false}
      keys={keys}
      onCreateKey={() => {
        const n = keys.length + 1;
        const id = `key_${n}`;
        setKeys((current) => [listed(id, `p${n}`), ...current]);
        return Promise.resolve({ id, key: `teakapi_secret_live_p${n}_secret` });
      }}
      onRevokeAllKeys={() => {
        onRevokeAll();
        setKeys([]);
        return Promise.resolve({ hasMore: false, revokedCount: keys.length });
      }}
      onRevokeKey={(id) => {
        onRevoke(id);
        setKeys((current) => current.filter((key) => key.id !== id));
        return Promise.resolve();
      }}
      onRotateKey={(id) => {
        const newId = `${id}_rotated`;
        setKeys((current) => [
          listed(newId, "rot"),
          ...current.filter((key) => key.id !== id),
        ]);
        return Promise.resolve({
          id: newId,
          key: "teakapi_secret_live_rot_secret",
        });
      }}
    />
  );
}

async function render() {
  const onRevoke = mock((_id: string) => undefined);
  const onRevokeAll = mock(() => undefined);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(<Fixture onRevoke={onRevoke} onRevokeAll={onRevokeAll} />)
  );
  return { onRevoke, onRevokeAll };
}

const buttonNamed = (name: string | RegExp) => {
  const match = [...document.querySelectorAll("button")].find((button) => {
    const label = (
      button.getAttribute("aria-label") ?? button.textContent
    )?.trim();
    return typeof name === "string" ? label === name : name.test(label ?? "");
  });
  if (!match) {
    throw new Error(`No button named ${name}`);
  }
  return match;
};

const click = (name: string | RegExp) =>
  act(async () => {
    buttonNamed(name).click();
    await Promise.resolve();
  });

const revealed = () =>
  [...document.querySelectorAll<HTMLInputElement>("input[readonly]")].map(
    (input) => input.value
  );

const alertDialog = () => document.querySelector('[role="alertdialog"]');

const confirmIn = async (label: string) => {
  const dialog = alertDialog();
  expect(dialog).not.toBeNull();
  const button = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent?.trim() === label
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
};

test("shows each key's creation date in the browser", async () => {
  await render();
  await click("Create key");
  expect(document.body.textContent).toMatch(/Created \w{3} \d{1,2}, 2026/);
});

test("revoking one key keeps another new key's one-time reveal", async () => {
  const { onRevoke } = await render();
  await click("Create key");
  await click("Create key");
  expect(revealed()).toEqual([
    "teakapi_secret_live_p2_secret",
    "teakapi_secret_live_p1_secret",
  ]);

  await click(/^Revoke teakapi_secret_live_p1_/);
  await confirmIn("Revoke key");

  expect(onRevoke).toHaveBeenCalledWith("key_1");
  expect(revealed()).toEqual(["teakapi_secret_live_p2_secret"]);
});

test("regenerating a key replaces only that key's reveal", async () => {
  await render();
  await click("Create key");
  await click("Create key");

  await click(/^Regenerate teakapi_secret_live_p1_/);
  await confirmIn("Regenerate key");

  expect(revealed()).toEqual([
    "teakapi_secret_live_rot_secret",
    "teakapi_secret_live_p2_secret",
  ]);
});

test("revoke asks first, and Cancel keeps the key", async () => {
  const { onRevoke } = await render();
  await click("Create key");

  await click(/^Revoke teakapi_secret_live_p1_/);
  expect(alertDialog()?.textContent).toContain("Revoke this API key?");
  expect(onRevoke).not.toHaveBeenCalled();

  await confirmIn("Cancel");
  expect(onRevoke).not.toHaveBeenCalled();
  expect(buttonNamed(/^Revoke teakapi_secret_live_p1_/)).toBeDefined();
});

test("Revoke all keys asks first and names what it breaks", async () => {
  const { onRevokeAll } = await render();
  await click("Create key");

  await click("Revoke all keys");
  expect(onRevokeAll).not.toHaveBeenCalled();
  expect(alertDialog()?.textContent).toContain("Revoke all API keys?");

  await confirmIn("Revoke all keys");
  expect(onRevokeAll).toHaveBeenCalledTimes(1);
  expect(revealed()).toEqual([]);
});

test("a reveal without a known key id survives other keys' revokes", () => {
  const reveal = { key: "teakapi_secret_live_x_secret" };
  expect(
    nextRevealedKeys([reveal], { kind: "revoked", keyId: "key_9" })
  ).toEqual([reveal]);
});
