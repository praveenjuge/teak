"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ComponentProps } from "react";
import { ArrowUpRight } from "vadivam-react";
import { ApiKeysPanel } from "./ApiKeysPanel";
import {
  type InboundEmailPanelProps,
  InboundEmailSection,
} from "./InboundEmailPanel";
import {
  SettingsLinkRow,
  SettingsLogoTile,
  SettingsPageIntro,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";

const ALL_APPS_URL = "https://teakvault.com/apps";

type AppLinkId = "chrome" | "firefox" | "apple" | "raycast";

const APP_LINKS: readonly {
  href: string;
  id: AppLinkId;
  logo: string;
}[] = [
  {
    id: "chrome",
    logo: "/platform-icons/chrome.svg",
    href: "https://chromewebstore.google.com/detail/teak/negnmfifahnnagnbnfppmlgfajngdpob",
  },
  {
    id: "firefox",
    logo: "/platform-icons/firefox.svg",
    href: "https://addons.mozilla.org/firefox/addon/teak/",
  },
  {
    id: "apple",
    logo: "/platform-icons/apple.svg",
    href: "https://apps.apple.com/us/app/teak-save-inspirations/id6756574989",
  },
  {
    id: "raycast",
    logo: "/platform-icons/raycast.svg",
    href: "https://www.raycast.com/praveenjuge/teak-raycast",
  },
];

export function AppsSection() {
  const t = useTranslations("settings.integrations");
  return (
    <SettingsSection
      action={
        <a
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground leading-5 hover:text-foreground"
          href={ALL_APPS_URL}
          rel="noopener"
          target="_blank"
        >
          {t("allApps")}
          <ArrowUpRight className="size-3.5" />
        </a>
      }
      id="apps"
      layout="list"
      title={t("appsTitle")}
    >
      {APP_LINKS.map(({ href, id, logo }) => (
        <SettingsLinkRow
          aria-label={t("opensInNewTab", { name: t(`apps.${id}`) })}
          external
          href={href}
          icon={<SettingsLogoTile src={logo} />}
          key={id}
          label={t(`apps.${id}`)}
          value={t("get")}
        />
      ))}
    </SettingsSection>
  );
}

interface IntegrationsSettingsProps {
  apiKeys: ComponentProps<typeof ApiKeysPanel>;
  inboundEmail?: InboundEmailPanelProps;
}

export function IntegrationsSettings({
  apiKeys,
  inboundEmail,
}: IntegrationsSettingsProps) {
  const tPages = useTranslations("settings.pages");
  return (
    <>
      <SettingsPageIntro title={tPages("integrations.title")} />
      <SettingsStack>
        {inboundEmail ? <InboundEmailSection {...inboundEmail} /> : null}
        <AppsSection />
        <ApiKeysPanel {...apiKeys} />
      </SettingsStack>
    </>
  );
}
