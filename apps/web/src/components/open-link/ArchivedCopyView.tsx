"use client";

import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, Ellipsis } from "vadivam-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The archived page never runs in Teak's origin: it loads from the files host
 * in a sandbox with no scripts and an opaque origin. Popups may leave it, so
 * its links open in a new tab outside the sandbox.
 */
export const ARCHIVE_FRAME_SANDBOX =
  "allow-popups allow-popups-to-escape-sandbox";

export interface ArchivedCopy {
  archiveUrl?: string;
  capturedAt: number;
  cardId: string;
  host: string;
  url: string;
}

const cardHref = (cardId: string) => `/?card=${encodeURIComponent(cardId)}`;

export function ArchivedCopyBar({
  capturedAt,
  cardId,
  host,
  url,
}: Omit<ArchivedCopy, "archiveUrl">) {
  const t = useTranslations("screens.openLink");
  const locale = useIntlLocale();
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(capturedAt);
  const detail = t("noLongerAvailable", { date, host });
  return (
    <header className="sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
      <Archive
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <h1 className="shrink-0">
        <Badge variant="secondary">{t("archivedCopy")}</Badge>
      </h1>
      <p
        className="min-w-0 flex-1 truncate text-muted-foreground text-sm"
        title={detail}
      >
        <span className="hidden sm:inline">{detail}</span>
        <span className="sm:hidden">{t("noLongerAvailableShort")}</span>
      </p>
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        <Button asChild size="sm" variant="ghost">
          <a href={url} rel="noopener noreferrer">
            {t("tryOriginal")}
          </a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={cardHref(cardId)}>{t("openInTeak")}</Link>
        </Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("moreActions")}
            className="size-8 shrink-0 sm:hidden"
            size="icon"
            variant="ghost"
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={url} rel="noopener noreferrer">
              {t("tryOriginal")}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={cardHref(cardId)}>{t("openInTeak")}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export function ArchiveFrame({ host, src }: { host: string; src: string }) {
  const t = useTranslations("screens.openLink");
  return (
    <div className="min-h-0 flex-1 bg-white">
      <iframe
        className="block size-full border-0 bg-white"
        referrerPolicy="no-referrer"
        sandbox={ARCHIVE_FRAME_SANDBOX}
        src={src}
        title={t("frameTitle", { host })}
      />
    </div>
  );
}

export function ArchiveMissing({ url }: { url: string }) {
  const t = useTranslations("screens.openLink");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-sm">{t("archiveMissing")}</p>
      <a
        className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
        href={url}
        rel="noopener noreferrer"
      >
        {t("tryOriginal")}
      </a>
    </div>
  );
}

type FrameStatus = "loading" | "ready" | "missing";

export function ArchivedCopyView(copy: ArchivedCopy) {
  const { archiveUrl, host, url } = copy;
  const [status, setStatus] = useState<FrameStatus>(
    archiveUrl ? "loading" : "missing"
  );

  useEffect(() => {
    if (!archiveUrl) {
      setStatus("missing");
      return;
    }
    let current = true;
    // A cross-origin frame can't say it failed, so ask first.
    fetch(archiveUrl, { method: "HEAD" }).then(
      (response) => {
        if (current) {
          setStatus(response.ok ? "ready" : "missing");
        }
      },
      () => {
        if (current) {
          setStatus("missing");
        }
      }
    );
    return () => {
      current = false;
    };
  }, [archiveUrl]);

  let body = <div className="min-h-0 flex-1 bg-white" />;
  if (status === "ready" && archiveUrl) {
    body = <ArchiveFrame host={host} src={archiveUrl} />;
  } else if (status === "missing") {
    body = <ArchiveMissing url={url} />;
  }
  return (
    <div className="flex h-dvh flex-col bg-background">
      <ArchivedCopyBar {...copy} />
      {body}
    </div>
  );
}
