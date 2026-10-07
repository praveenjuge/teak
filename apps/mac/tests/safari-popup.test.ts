import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Execute the actual popup workflow against DOM and native-message boundaries.
// Only the native transport is faked; feedback must remain plain text.
const source = readFileSync(
  new URL("../Shared (Extension)/Resources/popup.js", import.meta.url),
  "utf8"
);

async function popup(response: Record<string, unknown>) {
  const title = { textContent: "" };
  const message = {
    textContent: "",
    set innerHTML(_value: string) {
      throw new Error("Native feedback must not be interpreted as HTML");
    },
  };
  const body = { dataset: { state: "" } };
  const calls: unknown[] = [];
  const context = createContext({
    URL,
    document: {
      body,
      getElementById: (id: string) => {
        if (id === "title") {
          return title;
        }
        if (id === "message") {
          return message;
        }
        return { addEventListener() {} };
      },
    },
    browser: {
      runtime: {
        sendNativeMessage: (host: string, payload: { type: string }) => {
          expect(host).toBe("com.praveenjuge.teak-safari");
          if (payload.type === "signOut") {
            calls.push(payload);
            return Promise.resolve(response);
          }
          return Promise.resolve({ authenticated: false });
        },
      },
    },
  });
  runInContext(source, context);
  await runInContext("run()", context);
  await runInContext("signOut()", context);
  return { title, message, body, calls };
}

test("local-only Safari sign-out displays its limited scope and native notice as plain text", async () => {
  const notice =
    "Other installations may remain connected. <img src=x onerror=alert(1)>";
  const result = await popup({
    status: "signed-out",
    localOnly: true,
    message: notice,
  });
  expect(result.body.dataset.state).toBe("signed-out");
  expect(result.title.textContent).toBe("Signed out on this device");
  expect(result.message.textContent).toBe(notice);
  expect(result.calls).toEqual([{ version: 1, type: "signOut" }]);
});

test.each([undefined, {}, ""])(
  "local-only Safari feedback uses a clear fallback for invalid native messages %j",
  async (message) => {
    const result = await popup({
      status: "signed-out",
      localOnly: true,
      message,
    });
    expect(result.title.textContent).toBe("Signed out on this device");
    expect(result.message.textContent).toContain("other installations");
  }
);

test("confirmed Safari disconnect keeps the normal sign-out presentation", async () => {
  const result = await popup({ status: "signed-out", authenticated: false });
  expect(result.title.textContent).toBe("Signed out");
  expect(result.message.textContent).toBe("Sign in to save pages.");
});
