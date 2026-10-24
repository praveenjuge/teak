"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ComponentProps, ReactNode } from "react";
import {
  Command,
  ExternalLink,
  Globe,
  Smartphone,
  type VadivamIcon,
} from "vadivam-react";
import { ApiKeysPanel } from "./ApiKeysPanel";
import {
  InboundEmailPanel,
  type InboundEmailPanelProps,
} from "./InboundEmailPanel";
import { SettingsList } from "./SettingsDialog";
import {
  SettingsPageIntro,
  SettingsSection,
  SettingsStack,
} from "./SettingsSection";

const API_DOCS_URL = "https://teakvault.com/docs/api";
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

/** Where to get Teak's browser extensions and apps. */
function AppLinks() {
  const t = useTranslations("settings.integrations");
  return (
    <SettingsList>
      {APP_LINKS.map(({ href, icon: Icon, id }) => (
        <li key={id}>
          <a
            aria-label={t("opensInNewTab", { name: t(`apps.${id}.name`) })}
            className="flex items-center gap-3.5 px-4 py-3.5 outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/50 focus-visible:bg-accent/50"
            href={href}
            rel="noopener"
            target="_blank"
          >
            <Icon className="size-[18px] shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-sm">
                {t(`apps.${id}.name`)}
              </span>
              <span className="block truncate text-muted-foreground text-xs leading-5">
                {t(`apps.${id}.detail`)}
              </span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </a>
        </li>
      ))}
    </SettingsList>
  );
}

interface IntegrationsSettingsProps {
  apiKeys: ComponentProps<typeof ApiKeysPanel>;
  /** Save by email's state and switch; the card is left out without it. */
  inboundEmail?: InboundEmailPanelProps;
}

export function IntegrationsSettings({
  apiKeys,
  inboundEmail,
}: IntegrationsSettingsProps) {
  const t = useTranslations("settings.integrations");
  const tPages = useTranslations("settings.pages");
  const tInbound = useTranslations("settings.inboundEmail");
  const link = (href: string) => (chunks: ReactNode) => (
    <a
      className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
      href={href}
      rel="noopener"
      target="_blank"
    >
      {chunks}
    </a>
  );
  return (
    <>
      <SettingsPageIntro
        description={tPages("integrations.description")}
        title={tPages("integrations.title")}
      />
      <SettingsStack>
        {inboundEmail ? (
          <SettingsSection
            description={tInbound("intro")}
            id="save-by-email"
            title={t("saveByEmailTitle")}
          >
            <InboundEmailPanel {...inboundEmail} />
          </SettingsSection>
        ) : null}
        <SettingsSection
          description={t.rich("appsDescription", {
            link: link(ALL_APPS_URL),
          })}
          id="apps"
          title={t("appsTitle")}
        >
          <AppLinks />
        </SettingsSection>
        <SettingsSection
          description={t.rich("apiDescription", { link: link(API_DOCS_URL) })}
          id="api-keys"
          title={t("apiTitle")}
        >
          <ApiKeysPanel {...apiKeys} />
        </SettingsSection>
      </SettingsStack>
    </>
  );
}
