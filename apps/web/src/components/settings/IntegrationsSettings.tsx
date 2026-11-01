"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ComponentProps } from "react";
import {
  ArrowUpRight,
  Command,
  Globe,
  Smartphone,
  type VadivamIcon,
} from "vadivam-react";
import { ApiKeysPanel } from "./ApiKeysPanel";
import {
  type InboundEmailPanelProps,
  InboundEmailSection,
} from "./InboundEmailPanel";
import {
  SettingsPageIntro,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";

const ALL_APPS_URL = "https://teakvault.com/apps";

type AppLinkId = "chrome" | "firefox" | "apple" | "raycast";

const APP_LINKS: readonly {
  href: string;
  icon: VadivamIcon;
  id: AppLinkId;
}[] = [
  {
    id: "chrome",
    icon: Globe,
    href: "https://chromewebstore.google.com/detail/teak/negnmfifahnnagnbnfppmlgfajngdpob",
  },
  {
    id: "firefox",
    icon: Globe,
    href: "https://addons.mozilla.org/firefox/addon/teak/",
  },
  {
    id: "apple",
    icon: Smartphone,
    href: "https://apps.apple.com/us/app/teak-save-inspirations/id6756574989",
  },
  {
    id: "raycast",
    icon: Command,
    href: "https://www.raycast.com/praveenjuge/teak-raycast",
  },
];

export function AppsSection() {
  const t = useTranslations("settings.integrations");
  return (
    <SettingsSection
      action={
        <a
          className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
          href={ALL_APPS_URL}
          rel="noopener"
          target="_blank"
        >
          {t("allApps")}
          <ArrowUpRight className="size-3.5" />
        </a>
      }
      id="apps"
      title={t("appsTitle")}
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        {APP_LINKS.map(({ href, icon: Icon, id }) => (
          <li key={id}>
            <a
              aria-label={t("opensInNewTab", { name: t(`apps.${id}`) })}
              className="flex h-full items-center gap-2.5 rounded-xl border px-3 py-2.5 font-medium text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              href={href}
              rel="noopener"
              target="_blank"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">{t(`apps.${id}`)}</span>
            </a>
          </li>
        ))}
      </ul>
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
      <SettingsPageIntro
        description={tPages("integrations.description")}
        title={tPages("integrations.title")}
      />
      <SettingsStack>
        {inboundEmail ? <InboundEmailSection {...inboundEmail} /> : null}
        <AppsSection />
        <ApiKeysPanel {...apiKeys} />
      </SettingsStack>
    </>
  );
}
