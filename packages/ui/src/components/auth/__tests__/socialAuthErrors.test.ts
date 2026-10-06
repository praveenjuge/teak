import { describe, expect, test } from "bun:test";
import {
  isProviderNotConfiguredMessage,
  socialSignInErrorMessage,
} from "../socialAuthErrors";

describe("socialAuthErrors", () => {
  test("detects unconfigured-provider failures", () => {
    expect(isProviderNotConfiguredMessage("Provider not found")).toBe(true);
    expect(
      isProviderNotConfiguredMessage(
        "Google sign-in is not configured on this deployment."
      )
    ).toBe(true);
    expect(isProviderNotConfiguredMessage("PROVIDER_NOT_FOUND")).toBe(true);
    expect(isProviderNotConfiguredMessage("Invalid email or password")).toBe(
      false
    );
  });

  test("maps unconfigured providers to an action-oriented message", () => {
    expect(
      socialSignInErrorMessage("google", "Provider not found", "fallback")
    ).toBe(
      "Google sign-in isn't available on this server yet. Use email instead."
    );
    expect(
      socialSignInErrorMessage(
        "apple",
        "Apple sign-in is not configured on this deployment.",
        "fallback"
      )
    ).toBe(
      "Apple sign-in isn't available on this server yet. Use email instead."
    );
  });

  test.each([
    "signup disabled",
    "signup_disabled",
    "SIGN_UP_DISABLED",
    "Email and password sign up is not enabled",
    "new_user_signup_disabled",
    "registration disabled",
    "registration is disabled",
  ])("explains the sign-up pause for %s", (message) => {
    expect(socialSignInErrorMessage("google", message, "fallback")).toBe(
      "New sign-ups are paused while we upgrade sign-in"
    );
    expect(socialSignInErrorMessage("apple", message, "fallback")).toBe(
      "New sign-ups are paused while we upgrade sign-in"
    );
  });

  test("passes other failures and fallbacks through", () => {
    expect(socialSignInErrorMessage("google", "boom", "fallback")).toBe("boom");
    const unrelated =
      "registration provider configuration failed: connection disabled";
    expect(socialSignInErrorMessage("google", unrelated, "fallback")).toBe(
      unrelated
    );
    expect(socialSignInErrorMessage("google", undefined, "fallback")).toBe(
      "fallback"
    );
  });
});
