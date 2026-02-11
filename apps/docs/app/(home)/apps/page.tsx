import {
  Command,
  Globe,
  type LucideProps,
  Puzzle,
  Smartphone,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";

const WEB_APP_URL = "https://app.teakvault.com";
const APP_STORE_URL = "https://app.teakvault.com/register";
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/empty-title/negnmfifahnnagnbnfppmlgfajngdpob";
const RAYCAST_STORE_URL = "https://www.raycast.com";

export const metadata: Metadata = {
  title: "Teak Apps | Web, iOS, Chrome Extension, and Raycast",
  description:
    "Use Teak on the web, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
  keywords:
    "teak apps, teak ios, teak chrome extension, teak raycast extension, teak web app, visual bookmarking apps, cross platform inspiration",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak Apps",
    description:
      "Use Teak on the web, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
    type: "website",
    url: "https://teakvault.com/apps",
    siteName: "Teak",
    locale: "en_US",
    images: [
      {
        url: "/hero-image.png",
        width: 1200,
        height: 630,
        alt: "Teak - Web, iOS, Chrome Extension, and Raycast",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Teak Apps",
    description:
      "Use Teak on the web, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
    images: ["/hero-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://teakvault.com/apps",
  },
};

type PlatformAction =
  | {
      type: "button";
      label: string;
      href: string;
      icon?: ComponentType<LucideProps>;
    }
  | {
      type: "badge";
      href: string;
      src: string;
      alt: string;
      width: number;
      height: number;
    };

interface PlatformCard {
  name: string;
  copy: string;
  icon: ComponentType<LucideProps>;
  action: PlatformAction;
  footnote?: string;
}

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
  {
    name: "Raycast Extension",
    copy: "Save your clipboard, search your cards, and jump to favorites directly from Raycast.",
    icon: Command,
    action: {
      label: "Open Raycast Store",
      href: RAYCAST_STORE_URL,
      type: "button",
    },
    footnote: "Search for “Teak” in Raycast to install.",
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
        <h1 className="text-balance font-semibold text-4xl tracking-tight md:text-5xl">
          Teak, everywhere you create
        </h1>
        <p className="text-balance text-lg text-muted-foreground">
          Web, iPhone, Chrome, and Raycast stay perfectly in sync so the
          inspiration you save once is waiting on every device.
        </p>
      </section>

      <section className="mx-auto mt-12 grid w-full max-w-5xl gap-4 md:grid-cols-2 xl:grid-cols-4">
        {platformCards.map((card) => {
          const Icon = card.icon;
          const ActionIcon =
            card.action.type === "button" ? card.action.icon : undefined;

          return (
            <div
              className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-white p-6 shadow-sm dark:bg-gray-900"
              key={card.name}
            >
              <div className="flex items-center gap-2 font-semibold text-muted-foreground/80">
                <Icon className="size-4 text-primary" />
                {card.name}
              </div>
              <p className="text-muted-foreground">{card.copy}</p>
              <div className="flex flex-col gap-2 pt-2">
                {card.action.type === "button" ? (
                  <Button asChild size="lg">
                    <a
                      href={card.action.href}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {ActionIcon && (
                        <ActionIcon className="size-4 text-primary-foreground" />
                      )}
                      {card.action.label}
                    </a>
                  </Button>
                ) : (
                  <a
                    className="inline-flex justify-center"
                    href={card.action.href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Image
                      alt={card.action.alt}
                      className="h-auto max-w-52.5 object-contain"
                      height={card.action.height}
                      src={card.action.src}
                      unoptimized
                      width={card.action.width}
                    />
                  </a>
                )}
                {card.footnote && (
                  <p className="text-muted-foreground/80">{card.footnote}</p>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
