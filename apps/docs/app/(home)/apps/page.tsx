import {
  Command,
  Globe,
  type LucideProps,
  Monitor,
  Puzzle,
  Smartphone,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import type { ComponentType } from "react";

const WEB_APP_URL = "https://app.teakvault.com";
const APP_STORE_URL =
  "https://apps.apple.com/us/app/teak-save-inspirations/id6756574989";
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/empty-title/negnmfifahnnagnbnfppmlgfajngdpob";
const DESKTOP_DOWNLOAD_URL =
  "https://github.com/praveenjuge/teak/releases/latest";
const RAYCAST_STORE_URL = "https://www.raycast.com/praveenjuge/teak-raycast";
const RAYCAST_INSTALL_BUTTON_URL =
  "https://www.raycast.com/praveenjuge/teak-raycast/install_button@2x.png?v=1.1";

export const metadata: Metadata = {
  title: "Teak Apps | Desktop, Web, iOS, Chrome Extension, and Raycast",
  description:
    "Use Teak on desktop, web, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
  keywords:
    "teak desktop app, teak apps, teak ios, teak chrome extension, teak raycast extension, teak web app, visual bookmarking apps, cross platform inspiration",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak Apps",
    description:
      "Use Teak on desktop, web, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
    type: "website",
    url: "https://teakvault.com/apps",
    siteName: "Teak",
    locale: "en_US",
    images: [
      {
        url: "/hero-image.png",
        width: 1200,
        height: 630,
        alt: "Teak - Desktop, Web, iOS, Chrome Extension, and Raycast",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Teak Apps",
    description:
      "Use Teak on desktop, web, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
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
  action: PlatformAction;
  copy: string;
  emojiAlt: string;
  emojiSrc: string;
  footnote?: string;
  icon: ComponentType<LucideProps>;
  name: string;
}

// Emoji source references from thiings.co/things:
// - https://lftz25oez4aqbxpq.public.blob.vercel-storage.com/image-UN1NRnC5SEYcBvC7jJ1HjGKB22Q6Eb.png
// - https://lftz25oez4aqbxpq.public.blob.vercel-storage.com/image-LxbDZUY1gzuzF4AEv0OHAqsSGpAng8.png
// - https://lftz25oez4aqbxpq.public.blob.vercel-storage.com/image-xqy5MjgcznB4xWNihuD1LFkf0MW1NK.png
const platformCards: PlatformCard[] = [
  {
    name: "Web App",
    copy: "Manage every board, search instantly, and fly with keyboard shortcuts from any desktop browser.",
    emojiAlt: "Website emoji",
    emojiSrc: "/emojis/apps-web-website.webp",
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
    emojiAlt: "Smartphone emoji",
    emojiSrc: "/emojis/apps-ios-smartphone.webp",
    icon: Smartphone,
    action: {
      href: APP_STORE_URL,
      src: "/badges/app-store.svg",
      alt: "Download on the App Store",
      width: 140,
      height: 47,
      type: "badge",
    },
  },
  {
    name: "Chrome Extension",
    copy: "Save tabs, screenshots, or selected text in a click and Teak auto-grabs the metadata for you.",
    emojiAlt: "Puzzle piece emoji",
    emojiSrc: "/emojis/apps-chrome-puzzle-piece.webp",
    icon: Puzzle,
    action: {
      type: "badge",
      href: CHROME_STORE_URL,
      src: "/badges/chrome-web-store-badge.svg",
      alt: "Available in the Chrome Web Store",
      width: 160,
      height: 45,
    },
  },
  {
    name: "Desktop App (macOS)",
    copy: "Install the signed native desktop app for Apple Silicon and stay current with built-in auto updates.",
    emojiAlt: "Teak desktop app icon",
    emojiSrc: "/apps-desktop-icon.svg",
    icon: Monitor,
    action: {
      label: "Download for macOS",
      href: DESKTOP_DOWNLOAD_URL,
      type: "button",
    },
  },
  {
    name: "Raycast Extension",
    copy: "Save your clipboard, search your cards, and jump to favorites directly from Raycast.",
    emojiAlt: "Target face emoji",
    emojiSrc: "/emojis/home-why-target-face.webp",
    icon: Command,
    action: {
      type: "badge",
      href: RAYCAST_STORE_URL,
      src: RAYCAST_INSTALL_BUTTON_URL,
      alt: "Install teak-raycast Raycast Extension",
      width: 256,
      height: 64,
    },
  },
];

export default function AppsPage() {
  return (
    <main className="px-4 py-16">
      <section className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-balance font-bold text-4xl tracking-tighter md:text-5xl">
          Teak, everywhere you create
        </h1>
        <p className="text-lg text-muted-foreground">
          Desktop, web, iPhone, Chrome, and Raycast stay perfectly in sync so
          the inspiration you save once is waiting on every device.
        </p>
      </section>

      <section className="mx-auto mt-12 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
        {platformCards.map((card) => {
          const ActionIcon =
            card.action.type === "button" ? card.action.icon : undefined;

          return (
            <a
              aria-label={`Open ${card.name}`}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-white p-6 text-center shadow-xs transition-colors hover:border-border dark:bg-gray-900"
              href={card.action.href}
              key={card.name}
              rel="noopener noreferrer"
              target="_blank"
            >
              <Image
                alt={card.emojiAlt}
                className="size-14 object-contain"
                height={56}
                src={card.emojiSrc}
                unoptimized
                width={56}
              />
              <div className="font-semibold">{card.name}</div>
              <p className="text-balance text-muted-foreground">{card.copy}</p>
              <div className="flex flex-col items-center gap-2 pt-4">
                {card.action.type === "button" ? (
                  <span className="inline-flex h-11 w-auto items-center justify-center gap-2 rounded-md bg-primary px-6 text-primary-foreground text-sm shadow-xs transition-opacity group-hover:opacity-90">
                    {ActionIcon && (
                      <ActionIcon className="size-4 text-primary-foreground" />
                    )}
                    {card.action.label}
                  </span>
                ) : (
                  <span className="inline-flex justify-center transition-opacity group-hover:opacity-90">
                    <Image
                      alt={card.action.alt}
                      className="h-auto max-w-52.5 object-contain"
                      height={card.action.height}
                      src={card.action.src}
                      unoptimized
                      width={card.action.width}
                    />
                  </span>
                )}
                {card.footnote && (
                  <p className="text-muted-foreground/80">{card.footnote}</p>
                )}
              </div>
            </a>
          );
        })}
      </section>
    </main>
  );
}
