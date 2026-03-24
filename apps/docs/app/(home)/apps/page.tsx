import type { Metadata } from "next";
import { AppsGrid } from "./AppsGrid";

export const metadata: Metadata = {
  title: "Teak Apps | Desktop, Web, API, iOS, Chrome Extension, and Raycast",
  description:
    "Use Teak on desktop, web, API, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
  keywords:
    "teak desktop app, teak apps, teak api, teak ios, teak chrome extension, teak raycast extension, teak web app, visual bookmarking apps, cross platform inspiration",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak Apps",
    description:
      "Use Teak on desktop, web, API, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
    type: "website",
    url: "https://teakvault.com/apps",
    siteName: "Teak",
    locale: "en_US",
    images: [
      {
        url: "/hero-image.png",
        width: 1200,
        height: 630,
        alt: "Teak - Desktop, Web, API, iOS, Chrome Extension, and Raycast",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Teak Apps",
    description:
      "Use Teak on desktop, web, API, iPhone, Chrome, and Raycast. Capture ideas anywhere and reopen them instantly on every device.",
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

export default function AppsPage() {
  return (
    <main className="px-4 py-16">
      <section className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-balance font-bold text-4xl tracking-tighter md:text-5xl">
          Teak, everywhere you create
        </h1>
        <p className="text-lg text-muted-foreground">
          Desktop, web, API, iPhone, Chrome, and Raycast stay perfectly in sync
          so the inspiration you save once is waiting on every device.
        </p>
      </section>

      <AppsGrid />
    </main>
  );
}
