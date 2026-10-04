import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type MobileAuth, MobileAuthContext } from "../lib/mobile-auth-context";

let mode: MobileAuth["mode"] | undefined;
const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
process.env.EXPO_PUBLIC_CONVEX_SITE_URL = "http://127.0.0.1:3211";
afterAll(() => {
  if (siteUrl === undefined) {
    delete process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
  } else {
    process.env.EXPO_PUBLIC_CONVEX_SITE_URL = siteUrl;
  }
});

// Replace native rendering and the external query transport, keeping both
// application screens, helpers, and the auth client implementation real.
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
  List: container,
  LabeledContent: container,
  Text: container,
  Spacer: () => null,
  Button: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  TextField: ({ placeholder }: { placeholder: string }) => (
    <input placeholder={placeholder} />
  ),
  SecureField: ({ placeholder }: { placeholder: string }) => (
    <input placeholder={placeholder} />
  ),
}));
const modifier = () => ({});
mock.module("@expo/ui/swift-ui/modifiers", () => ({
  buttonStyle: modifier,
  controlSize: modifier,
  disabled: modifier,
  font: modifier,
  foregroundStyle: modifier,
  frame: modifier,
  lineLimit: modifier,
  padding: modifier,
  tint: modifier,
  listStyle: modifier,
  scrollDisabled: modifier,
}));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => mode,
}));
mock.module("react-native", () => ({
  Alert: { alert: () => {} },
  Keyboard: { dismiss: () => {} },
  Platform: { OS: "ios" },
  PlatformColor: () => "black",
  useColorScheme: () => "light",
  Pressable: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <button type="button">{accessibilityLabel}</button>
  ),
}));
mock.module("expo-router", () => ({
  router: { push: () => {}, replace: () => {} },
  useFocusEffect: () => {},
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) =>
      options.headerRight?.() ?? null,
  },
}));
mock.module("expo-apple-authentication", () => ({
  isAvailableAsync: async () => true,
}));
mock.module("expo-constants", () => ({
  default: { expoConfig: { scheme: "teak" } },
}));
mock.module("expo-secure-store", () => ({
  getItem: () => null,
  setItem: () => {},
}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({ id: "expo" }),
}));
mock.module("@expo/vector-icons/MaterialIcons", () => ({
  default: () => null,
}));
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
  "sign-up renders creation only when explicitly open (%s)",
  (disabled) => {
    mode =
      disabled === undefined
        ? undefined
        : {
            primary: "betterauth",
            signupsDisabled: disabled,
            accountChangesPaused: false,
          };
    if (disabled === undefined) {
      expect(() => renderScreen(<SignUpScreen />)).toThrow(
        "Mobile authentication provider is missing"
      );
      return;
    }
    const markup = renderScreen(<SignUpScreen />);
    if (disabled === false) {
      expect(markup).toContain("Enter your email");
      expect(markup).toContain("Enter your password");
      expect(markup).toContain("Create account");
    } else {
      expect(markup).not.toContain("<input");
      expect(markup).not.toContain("Create account");
      expect(markup).toContain(
        disabled ? "New sign-ups are paused" : "Loading"
      );
    }
  }
);

test.each([undefined, true, false])(
  "welcome keeps sign-in available while registration follows the freeze (%s)",
  (disabled) => {
    mode =
      disabled === undefined
        ? undefined
        : {
            primary: "betterauth",
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
