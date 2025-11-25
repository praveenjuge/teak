import { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { Globe, Puzzle, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";

const WEB_APP_URL = "https://app.teakvault.com";
const APP_STORE_URL = "https://accounts.teakvault.com/waitlist?platform=ios";
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/empty-title/negnmfifahnnagnbnfppmlgfajngdpob";

export const metadata: Metadata = {
  title: "Teak Apps | Web, iOS, and Chrome Extension",
  description:
    "Use Teak on the web, iPhone, and Chrome. Capture ideas anywhere and reopen them instantly on every device.",
  keywords:
    "teak apps, teak ios, teak chrome extension, teak web app, visual bookmarking apps, cross platform inspiration",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak Apps",
    description:
      "Use Teak on the web, iPhone, and Chrome. Capture ideas anywhere and reopen them instantly on every device.",
    type: "website",
    url: "https://teakvault.com/apps",
  },
  twitter: {
    card: "summary_large_image",
    title: "Teak Apps",
    description:
      "Use Teak on the web, iPhone, and Chrome. Capture ideas anywhere and reopen them instantly on every device.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

type PlatformAction =
  | {
      type: "button";
      label: string;
      href: string;
      icon?: ComponentType<SVGProps<SVGSVGElement>>;
    }
  | {
      type: "badge";
      href: string;
      src: string;
      alt: string;
      width: number;
      height: number;
    };

type PlatformCard = {
  name: string;
  copy: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  action: PlatformAction;
  footnote?: string;
};

const platformCards: PlatformCard[] = [
  {
    name: "Web App",
    copy: "Manage every board, search instantly, and fly with keyboard shortcuts from any desktop browser.",
    icon: Globe,
    action: {
      label: "Open Web App",
      href: WEB_APP_URL,
      type: "button",
    },
  },
  {
    name: "iOS App",
    copy: "Drop photos, voice notes, or links straight from the share sheet and they appear everywhere else instantly.",
    icon: Smartphone,
    action: {
      href: APP_STORE_URL,
      src: "/badges/app-store.svg",
      alt: "Download on the App Store",
      width: 180,
      height: 60,
      type: "badge",
    },
  },
  {
    name: "Chrome Extension",
    copy: "Save tabs, screenshots, or selected text in a click and Teak auto-grabs the metadata for you.",
    icon: Puzzle,
    action: {
      type: "badge",
      href: CHROME_STORE_URL,
      src: "/badges/chrome-web-store.svg",
      alt: "Available in the Chrome Web Store",
      width: 206,
      height: 58,
    },
  },
];

const isAppsPageEnabled =
  process.env.NEXT_PUBLIC_ENABLE_APPS_PAGE?.toLowerCase() === "true";

export default function AppsPage() {
  if (!isAppsPageEnabled) {
    notFound();
  }

  return (
    <main className="px-4 py-16">
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          Teak, everywhere you create
        </h1>
        <p className="text-balance text-lg text-muted-foreground">
          Web, iPhone, and Chrome stay perfectly in sync so the inspiration you
          save once is waiting on every device.
        </p>
      </section>

      <section className="mx-auto mt-12 grid w-full max-w-5xl gap-4 md:grid-cols-3">
        {platformCards.map((card) => {
          const Icon = card.icon;
          const ActionIcon =
            card.action.type === "button" ? card.action.icon : undefined;

          return (
            <div
              key={card.name}
              className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-white p-6 shadow-sm dark:bg-gray-900"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground/80">
                <Icon className="size-4 text-primary" />
                {card.name}
              </div>
              <p className="text-sm text-muted-foreground">{card.copy}</p>
              <div className="flex flex-col gap-2 pt-2">
                {card.action.type === "button" ? (
                  <Button size="lg" asChild>
                    <a
                      href={card.action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {ActionIcon && (
                        <ActionIcon className="size-4 text-primary-foreground" />
                      )}
                      {card.action.label}
                    </a>
                  </Button>
                ) : (
                  <a
                    href={card.action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex justify-center"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={card.action.src}
                      alt={card.action.alt}
                      width={card.action.width}
                      height={card.action.height}
                      className="h-auto max-w-[210px] object-contain"
                    />
                  </a>
                )}
                {card.footnote && (
                  <p className="text-xs text-muted-foreground/80">
                    {card.footnote}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
