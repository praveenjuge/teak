import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type MobileAuth, MobileAuthContext } from "../lib/mobile-auth-context";
import { secureStoreData, secureStoreMock } from "./secureStoreMock";

let mode: MobileAuth["mode"] | undefined;
interface AlertButton {
  onPress?: (value?: string) => void | Promise<void>;
  text?: string;
}
let alertButtons: AlertButton[] = [];
let promptButtons: AlertButton[] = [];
let destinations: string[] = [];
const nativeWeb = { Request, Response, AbortController, AbortSignal };
const nativeFetch = globalThis.fetch;
let settingsFetch: typeof fetch | undefined;
globalThis.fetch = ((input, init) =>
  (settingsFetch ?? nativeFetch)(input, init)) as typeof fetch;
afterAll(() => {
  globalThis.fetch = nativeFetch;
});

// Replace native rendering and the external query transport, keeping the
// application screens and the WorkOS session implementation real.
const container = ({
  children,
  label,
}: {
  children?: ReactNode;
  label?: string;
}) => (
  <div>
    {label}
    {children}
  </div>
);
mock.module("@expo/ui/swift-ui", () => ({
  Host: container,
  HStack: container,
  VStack: container,
  LabeledContent: container,
  Form: container,
  Section: container,
  Picker: container,
  Image: () => null,
  ProgressView: () => null,
  Text: container,
  Spacer: () => null,
  Button: ({
    children,
    onPress,
    modifiers = [],
  }: {
    children?: ReactNode;
    onPress?: () => void;
    modifiers?: Array<{ disabled?: boolean }>;
  }) => (
    <button
      disabled={modifiers.some((m) => m.disabled)}
      onClick={onPress}
      type="button"
    >
      {children}
    </button>
  ),
}));
const modifier = () => ({});
mock.module("@expo/ui/swift-ui/modifiers", () => ({
  buttonStyle: modifier,
  controlSize: modifier,
  disabled: (value: boolean) => ({ disabled: value }),
  font: modifier,
  foregroundStyle: modifier,
  frame: modifier,
  lineLimit: modifier,
  padding: modifier,
  tint: modifier,
  pickerStyle: modifier,
  tag: modifier,
}));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => mode,
}));
mock.module("react-native", () => ({
  Alert: {
    alert: (_title: string, _message: string, buttons: AlertButton[]) => {
      alertButtons = buttons;
    },
    prompt: (_title: string, _message: string, buttons: AlertButton[]) => {
      promptButtons = buttons;
    },
  },
  Appearance: { setColorScheme: () => {} },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  Linking: { addEventListener: () => ({ remove: () => {} }) },
  processColor: (color: string) => color,
  Platform: { OS: "ios" },
  PlatformColor: () => "black",
  useColorScheme: () => "light",
}));
mock.module("expo-router", () => ({
  router: { push: () => {}, replace: () => {} },
  useRouter: () => ({
    push: () => {},
    replace: (path: string) => {
      destinations.push(path);
    },
  }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) =>
      options.headerRight?.() ?? null,
  },
}));
mock.module("expo-network", () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
}));
mock.module("expo-auth-session", () => ({
  CodeChallengeMethod: { S256: "S256" },
  ResponseType: { Code: "code" },
  AuthRequest: class {
    constructor() {
      throw new Error("Unexpected browser sign-in");
    }
  },
}));
mock.module("expo-web-browser", () => ({
  maybeCompleteAuthSession: () => {},
  openBrowserAsync: () => {
    throw new Error("Unexpected browser logout during deletion");
  },
}));
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
mock.module("expo-secure-store", () => secureStoreMock);
mock.module("react-native-svg", () => ({
  default: () => null,
  Svg: () => null,
  Path: () => null,
}));

const { default: SignInScreen } = await import("../app/(auth)/sign-in");
const { default: SignUpScreen } = await import("../app/(auth)/sign-up");
const { default: WelcomeScreen } = await import("../app/(auth)/welcome");

function renderScreen(screen: ReactNode): string {
  if (!mode) {
    return renderToStaticMarkup(screen);
  }
  const auth: MobileAuth = {
    mode,
    user: null,
    isPending: false,
    hasStoredSession: false,
    refreshSession: () => Promise.resolve(false),
    signIn: () => Promise.resolve(false),
    signOut: () => Promise.resolve(),
  };
  return renderToStaticMarkup(
    <MobileAuthContext.Provider value={auth}>
      {screen}
    </MobileAuthContext.Provider>
  );
}

test.each([undefined, true, false])(
  "welcome keeps sign-in available while registration follows the freeze (%s)",
  (disabled) => {
    mode =
      disabled === undefined
        ? undefined
        : {
            primary: "workos",
            authKitClientId: "client_TEST",
            signupsDisabled: disabled,
            accountChangesPaused: false,
          };
    if (disabled === undefined) {
      expect(() => renderScreen(<WelcomeScreen />)).toThrow(
        "Mobile authentication provider is missing"
      );
      return;
    }
    const markup = renderScreen(<WelcomeScreen />);
    expect(markup).toContain("Continue with Google");
    expect(markup).toContain("Login with Email");
    expect(markup.includes("Register with Email")).toBe(disabled === false);
    expect(markup.includes("New sign-ups are paused")).toBe(disabled === true);
  }
);

test.each([true, false])(
  "WorkOS email screens use hosted sign-in and honor the freeze (%s)",
  (paused: boolean) => {
    mode = {
      primary: "workos",
      authKitClientId: "client_TEST",
      signupsDisabled: paused,
      accountChangesPaused: false,
    };
    const signIn = renderScreen(<SignInScreen />);
    expect(signIn).toContain("Continue with email");
    expect(signIn).not.toContain("<input");
    const signUp = renderScreen(<SignUpScreen />);
    expect(signUp).not.toContain("<input");
    expect(signUp.includes("Continue with email")).toBe(!paused);
    expect(signUp.includes("New sign-ups are paused")).toBe(paused);
    const welcome = renderScreen(<WelcomeScreen />);
    expect(welcome).toContain("Continue with Google");
    expect(welcome).toContain("Continue with Apple");
    expect(welcome.includes("Register with Email")).toBe(!paused);
  }
);

// Deletion risks: paused changes, premature local logout, rejected
// acceptance, or redundant protected revocation after account locking.
let ownsDom = false;
async function settingsFixture(paused = false) {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ url: "http://localhost:3211" });
    ownsDom = true;
  }
  Object.assign(globalThis, nativeWeb, { IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { createConvexTransport } = await import(
    "../../../packages/ui/src/components/settings/__tests__/helpers/convexTransport"
  );
  const { ThemePreferenceProvider } = await import("../lib/theme-preference");
  const { WorkosAuthProvider } = await import("../lib/MobileAuthProviders");
  const { getWorkosSession } = await import("../lib/workos-native-auth");
  const { default: Settings } = await import("../app/(tabs)/settings/index");
  const originalFetch = globalThis.fetch;
  const originalConvexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  process.env.EXPO_PUBLIC_CONVEX_URL = "https://fixture.convex.cloud";
  const clientId = `client_SETTINGS${crypto.randomUUID().replaceAll("-", "")}`;
  settingsFetch = ((input) => {
    const url = String(input);
    if (url === "https://api.workos.com/user_management/authenticate") {
      return Promise.resolve(
        Response.json({
          access_token: `fixture.${btoa(JSON.stringify({ iss: `https://api.workos.com/user_management/${clientId}`, sub: "user_SETTINGS", sid: "session_SETTINGS", exp: Math.floor(Date.now() / 1000) + 600 }))}.fixture`,
          refresh_token: "fixture-settings-refresh",
          user: {
            id: "user_SETTINGS",
            email: "fixture@example.test",
            email_verified: true,
            external_id: "permanent-vault",
          },
        })
      );
    }
    if (url === "https://fixture.convex.cloud/api/mutation") {
      return Promise.resolve(
        Response.json({
          status: "success",
          value: { status: "ok", userId: "permanent-vault" },
        })
      );
    }
    return Promise.reject(new Error(`Unexpected fixture request: ${url}`));
  }) as typeof fetch;
  globalThis.fetch = settingsFetch;
  secureStoreData.clear();
  const session = getWorkosSession(clientId);
  await session.hydrate();
  await session.exchangeCode(
    "fixture-code",
    "v".repeat(43),
    session.beginSignIn()
  );
  const transport = createConvexTransport();
  // The helper replaces mutation/query transport; suppress its unused socket
  // authentication transport while keeping the real native provider lifecycle.
  transport.client.setAuth = () => {};
  mode = {
    primary: "workos",
    authKitClientId: clientId,
    accountChangesPaused: paused,
    signupsDisabled: false,
  };
  alertButtons = [];
  promptButtons = [];
  destinations = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const content = (
    <ThemePreferenceProvider>
      <Settings />
    </ThemePreferenceProvider>
  );
  await act(() => {
    root.render(
      <WorkosAuthProvider client={transport.client} mode={mode!}>
        {content}
      </WorkosAuthProvider>
    );
    return Promise.resolve();
  });
  let pendingDeletion: Promise<void> = Promise.resolve();
  return {
    act,
    finished: () => pendingDeletion,
    container,
    session,
    transport,
    confirm: async (wait = true) => {
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((b) => b.textContent?.includes("Delete Account"))
          ?.click();
        alertButtons.find((b) => b.text === "DELETE ACCOUNT")?.onPress?.();
        const deletion = promptButtons
          .find((b) => b.text === "Delete")
          ?.onPress?.("delete account");
        pendingDeletion = Promise.resolve(deletion);
        if (wait) {
          await pendingDeletion;
        }
      });
    },
    close: async () => {
      await act(() => root.unmount());
      await transport.client.close();
      await session.clear();
      container.remove();
      globalThis.fetch = originalFetch;
      settingsFetch = undefined;
      if (originalConvexUrl === undefined) {
        delete process.env.EXPO_PUBLIC_CONVEX_URL;
      } else {
        process.env.EXPO_PUBLIC_CONVEX_URL = originalConvexUrl;
      }
    },
  };
}
afterAll(async () => {
  if (ownsDom) {
    await GlobalRegistrator.unregister();
  }
});

test("WorkOS deletion retains credentials until acceptance, then clears locally without protected revocation", async () => {
  const fixture = await settingsFixture();
  let accept: (() => void) | undefined;
  fixture.transport.onCall(async () => {
    await new Promise<void>((resolve) => {
      accept = resolve;
    });
    return null;
  });
  try {
    await fixture.confirm(false);
    expect(fixture.transport.calls.map((call) => call.path)).toEqual([
      "accountDeletion:deleteMyAccount",
    ]);
    expect(fixture.session.getSnapshot().user).not.toBeNull();
    expect(destinations).toEqual([]);
    await fixture.act(() => {
      accept?.();
      return fixture.finished();
    });
    expect(fixture.session.getSnapshot().user).toBeNull();
    expect(secureStoreData.size).toBe(0);
    expect(destinations).toEqual(["/(auth)/welcome"]);
    expect(fixture.transport.calls).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test("rejected WorkOS deletion keeps credentials and shows the error", async () => {
  const fixture = await settingsFixture();
  fixture.transport.onCall(() => Promise.reject(new Error("Denied by server")));
  try {
    await fixture.confirm();
    expect(fixture.session.getSnapshot().user).not.toBeNull();
    expect(destinations).toEqual([]);
    expect(fixture.container.textContent).toContain(
      "Something went wrong while deleting your account."
    );
  } finally {
    await fixture.close();
  }
});

test("paused account changes cannot prompt or request deletion", async () => {
  const fixture = await settingsFixture(true);
  try {
    await fixture.confirm();
    expect(alertButtons).toHaveLength(0);
    expect(fixture.transport.calls).toHaveLength(0);
    expect(destinations).toEqual([]);
  } finally {
    await fixture.close();
  }
});
