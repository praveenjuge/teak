import { describe, expect, mock, test } from "bun:test";
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: { children?: ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement("a", { href, ...props }, children),
}));
mock.module("next/navigation", () => ({
  usePathname: () => "/settings",
}));

const { SettingsOverview } = await import("../SettingsOverview");
const { PlanSettings } = await import("../PlanSettings");
const { IntegrationsSettings } = await import("../IntegrationsSettings");

const overviewProps = {
  accountLoading: false,
  apiKeyCount: 0,
  cardCount: 3,
  deviceCount: 2,
  devicesHaveMore: false,
  email: "hello@example.com",
  exportState: {
    canStartNew: true,
    job: null,
    quotaResetMs: 0,
  },
  hasPremium: false,
  inboundEmailEnabled: false,
  locale: "en",
  name: "Ada Lovelace",
  onSignOut: mock(() => undefined),
  signOutLoading: false,
};

const checkout = {
  loadingPlanId: null,
  monthlyPlanId: "plan_monthly",
  onCheckout: mock(() => undefined),
  yearlyPlanId: "plan_yearly",
};

const links = (markup: string) =>
  [...markup.matchAll(/<a[^>]*href="([^"]+)"/g)].map(([, href]) => href);

describe("SettingsOverview", () => {
  test("keeps sign out and the pages available while the account loads", () => {
    const markup = renderToStaticMarkup(
      <SettingsOverview
        {...overviewProps}
        accountLoading
        apiKeyCount={undefined}
        deviceCount={undefined}
        exportState={undefined}
        inboundEmailEnabled={undefined}
      />
    );

    expect(markup).toContain("Sign out");
    expect(markup).not.toContain("hello@example.com");
    expect(markup).not.toContain("Free Plan");
    expect(markup).toContain('data-slot="setting-value-skeleton"');
    for (const href of [
      "/settings/plan",
      "/settings/appearance",
      "/settings/integrations",
      "/settings/security",
      "/settings/data",
    ]) {
      expect(links(markup)).toContain(href);
    }
  });

  test("shows who is signed in and a summary of every page once loaded", () => {
    const markup = renderToStaticMarkup(
      <SettingsOverview {...overviewProps} />
    );

    expect(markup).toContain("Signed in as");
    expect(markup).toContain(">Ada Lovelace<");
    // The address wraps only before its @, never at a hyphen inside it.
    expect(markup).toContain('title="hello@example.com"');
    expect(markup).toContain(">hello</span><wbr/>");
    expect(markup).toContain(">@example.com<");
    expect(markup.split("Free Plan")).toHaveLength(2);
    expect(markup).toContain("Free Plan · 3 of 200 cards");
    expect(markup).toContain("Save by email off · no API keys");
    expect(markup).toContain("2 devices signed in");
    expect(markup).toContain("Bring cards in, or take them with you");
  });

  test("shows the email as text, not as a button", () => {
    const markup = renderToStaticMarkup(
      <SettingsOverview {...overviewProps} name={null} />
    );
    const buttonTexts = [
      ...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g),
    ].map(([, inner]) => inner);

    expect(markup.split("hello@example.com")).toHaveLength(2);
    expect(buttonTexts.some((text) => text.includes("hello@example.com"))).toBe(
      false
    );
  });

  test("summarises Pro, a running export and more devices than one page", () => {
    const markup = renderToStaticMarkup(
      <SettingsOverview
        {...overviewProps}
        apiKeyCount={2}
        deviceCount={25}
        devicesHaveMore
        exportState={{
          canStartNew: false,
          job: {
            createdAt: 1,
            downloadAvailable: false,
            id: "job",
            status: "running",
            updatedAt: 1,
          },
          quotaResetMs: 0,
        }}
        hasPremium
        inboundEmailEnabled
      />
    );

    expect(markup).toContain("Pro · 3 cards");
    expect(markup).toContain("Save by email on · 2 API keys");
    expect(markup).toContain("25+ devices signed in");
    expect(markup).toContain("Export in progress");
    expect(markup).toContain("3 cards saved, with no limit.");
    expect(markup).not.toContain("Upgrade to Pro");
  });

  test("shows cards used, the way to upgrade, the apps and the shortcuts", () => {
    const markup = renderToStaticMarkup(
      <SettingsOverview {...overviewProps} />
    );

    expect(markup).toContain("Cards used");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="3"');
    expect(markup).toMatch(
      /<a[^>]*href="\/settings\/plan"[^>]*>Upgrade to Pro<\/a>/
    );
    expect(markup).toContain("Apps and extensions");
    expect(links(markup)).toContain("https://teakvault.com/apps");
    expect(markup).toContain("Keyboard shortcuts");
    expect(markup).toContain('aria-label="Keyboard shortcuts"');
  });
});

describe("PlanSettings", () => {
  test("the free plan shows its usage and the upgrade choice", () => {
    const markup = renderToStaticMarkup(
      <PlanSettings
        accountLoading={false}
        cardCount={150}
        checkout={checkout}
        hasPremium={false}
        onCreateCustomerPortal={mock(() => Promise.resolve())}
      />
    );

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="150"');
    expect(markup).toContain('aria-valuemax="200"');
    expect(markup).toContain("150 of 200 cards");
    expect(markup).toContain("50 cards left");
    expect(markup).toContain("Upgrade to Pro");
    expect(markup).toContain("Continue to checkout");
    expect(markup).not.toContain("Manage subscription");
  });

  test("a full free plan says so", () => {
    const markup = renderToStaticMarkup(
      <PlanSettings
        accountLoading={false}
        cardCount={200}
        checkout={checkout}
        hasPremium={false}
        onCreateCustomerPortal={mock(() => Promise.resolve())}
      />
    );

    expect(markup).toContain("Limit reached");
    expect(markup).toContain("card limit");
  });

  test("Pro offers the subscription portal instead of checkout", () => {
    const markup = renderToStaticMarkup(
      <PlanSettings
        accountLoading={false}
        cardCount={1234}
        checkout={checkout}
        hasPremium
        onCreateCustomerPortal={mock(() => Promise.resolve())}
      />
    );

    expect(markup).toContain("Manage subscription");
    expect(markup).toContain("1,234 cards saved");
    expect(markup).not.toContain("Continue to checkout");
    expect(markup).not.toContain('role="progressbar"');
  });

  test("shows neither plan while the account loads", () => {
    const markup = renderToStaticMarkup(
      <PlanSettings
        accountLoading
        cardCount={0}
        checkout={checkout}
        onCreateCustomerPortal={mock(() => Promise.resolve())}
      />
    );

    expect(markup).not.toContain("Free Plan");
    expect(markup).not.toContain("Continue to checkout");
    expect(markup).not.toContain("Manage subscription");
  });
});

describe("IntegrationsSettings", () => {
  test("lists Save by email, the apps in new tabs, and API keys", () => {
    const markup = renderToStaticMarkup(
      <IntegrationsSettings
        apiKeys={{
          isLoading: false,
          keys: [],
          onCreateKey: mock(() => Promise.resolve(null)),
          onRevokeKey: mock(() => Promise.resolve()),
          onRotateKey: mock(() => Promise.resolve(null)),
        }}
        inboundEmail={{
          onDisable: mock(() => Promise.resolve()),
          onEnable: mock(() => Promise.resolve()),
          state: {
            address: "save@in.teakvault.com",
            enabled: false,
            lastReceivedAt: null,
            sender: "hello@example.com",
            senderVerified: true,
          },
        }}
      />
    );

    expect(markup).toContain('id="save-by-email"');
    expect(markup).toContain(
      "Send or forward email to Teak, and it&#x27;s saved as cards."
    );
    expect(markup).toContain("Turn on");
    expect(markup).toContain('id="apps"');
    expect(markup).toContain('aria-label="Chrome (opens in a new tab)"');
    expect(markup).toContain('id="api-keys"');
    expect(markup).toContain("Create key");
    const external = [...markup.matchAll(/<a[^>]*target="_blank"[^>]*>/g)].map(
      ([tag]) => tag
    );
    expect(external.length).toBeGreaterThanOrEqual(6);
    expect(external.every((tag) => tag.includes('rel="noopener"'))).toBe(true);
  });
});
