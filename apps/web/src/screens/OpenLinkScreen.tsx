"use client";

import { api } from "@teak/convex";
import { captureEvent } from "@teak/convex/shared/analytics";
import {
  getSafeUrlHostname,
  sanitizeExternalUrl,
} from "@teak/convex/shared/utils/safeUrl";
import { useTranslations } from "@teak/i18n/react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteFavicon } from "@/components/cards/SiteFavicon";
import {
  type ArchivedCopy,
  ArchivedCopyView,
} from "@/components/open-link/ArchivedCopyView";
import { useQuery } from "@/lib/convexQueryHooks";
import { cn } from "@/lib/utils";

/** A redirect quicker than this shows nothing at all. */
export const OPEN_LINK_FADE_IN_MS = 120;
/** After this, "Open the original now" appears. */
export const OPEN_LINK_SLOW_MS = 1500;
/** After this, the original opens whatever the check says. */
export const OPEN_LINK_LIMIT_MS = 4000;

type LinkOpenTarget = FunctionReturnType<
  typeof api.card.linkCheck.checkCardLinkForOpen
>;

type Phase =
  | { kind: "checking" }
  | { kind: "unavailable" }
  | { copy: ArchivedCopy; kind: "archive" };

const hostOf = (url: string | undefined) =>
  getSafeUrlHostname(url)?.replace(/^www\./u, "");

const reportCheck = (target: LinkOpenTarget) => {
  if (target.target === "unavailable" || !target.outcome) {
    return;
  }
  captureEvent("dead_link_checked", {
    outcome: target.outcome,
    ...(target.reason ? { reason: target.reason } : {}),
  });
  if (target.target === "archive") {
    captureEvent("archived_copy_opened", { surface: "open_page" });
  }
};

function CheckingLink({
  host,
  onOpenOriginal,
  original,
  slow,
  visible,
}: {
  host?: string;
  onOpenOriginal: () => void;
  original?: string;
  slow: boolean;
  visible: boolean;
}) {
  const t = useTranslations("screens.openLink");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div
        aria-live="polite"
        className={cn(
          "flex max-w-full flex-col items-center gap-3 text-center transition-opacity duration-150 ease-out",
          visible && host ? "opacity-100" : "opacity-0"
        )}
      >
        {host ? (
          <p className="flex min-w-0 max-w-[80vw] items-center gap-2 text-muted-foreground text-sm">
            <SiteFavicon className="size-4" hostname={host} />
            <span className="truncate">{t("checking", { host })}</span>
          </p>
        ) : null}
        {slow && original ? (
          <a
            className="text-sm underline-offset-4 hover:underline"
            href={original}
            onClick={(event) => {
              event.preventDefault();
              onOpenOriginal();
            }}
            rel="noopener noreferrer"
          >
            {t("openOriginalNow")}
          </a>
        ) : null}
      </div>
    </main>
  );
}

function UnavailableCard() {
  const t = useTranslations("screens.openLink");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-4 text-center">
      <p className="text-sm">{t("unavailable")}</p>
      <Link
        className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
        href="/"
      >
        {t("backToTeak")}
      </Link>
    </main>
  );
}

export function OpenLinkScreen({ cardId }: { cardId: string }) {
  const t = useTranslations("screens.openLink");
  const checkLink = useAction(api.card.linkCheck.checkCardLinkForOpen);
  const card = useQuery(api.cards.getCardByUrlId, { id: cardId });
  const original = sanitizeExternalUrl(card?.url);
  const host = hostOf(card?.url);

  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const leaving = useRef<boolean>(false);
  const started = useRef<boolean>(false);

  const leaveFor = useCallback((url: string) => {
    if (leaving.current) {
      return;
    }
    leaving.current = true;
    window.location.replace(url);
  }, []);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setVisible(true), OPEN_LINK_FADE_IN_MS),
      window.setTimeout(() => setSlow(true), OPEN_LINK_SLOW_MS),
      window.setTimeout(() => setGaveUp(true), OPEN_LINK_LIMIT_MS),
    ];
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    checkLink({ cardId }).then(
      (target) => {
        if (leaving.current) {
          return;
        }
        reportCheck(target);
        if (target.target === "unavailable") {
          setPhase({ kind: "unavailable" });
        } else if (target.target === "original") {
          leaveFor(target.url);
        } else {
          setPhase({
            kind: "archive",
            copy: {
              archiveUrl: target.archiveUrl,
              capturedAt: target.capturedAt,
              cardId,
              host: target.sourceHost ?? hostOf(target.url) ?? target.url,
              url: target.url,
            },
          });
        }
      },
      // A check that fails is never shown as dead: open the original.
      () => setGaveUp(true)
    );
  }, [cardId, checkLink, leaveFor]);

  useEffect(() => {
    if (phase.kind !== "checking" || !gaveUp) {
      return;
    }
    if (original) {
      leaveFor(original);
    } else if (card === null) {
      setPhase({ kind: "unavailable" });
    }
  }, [card, gaveUp, leaveFor, original, phase.kind]);

  const archiveTitle =
    phase.kind === "archive"
      ? `${t("archivedCopy")} · ${phase.copy.host}`
      : null;
  useEffect(() => {
    if (archiveTitle) {
      document.title = archiveTitle;
    }
  }, [archiveTitle]);

  if (phase.kind === "unavailable") {
    return <UnavailableCard />;
  }
  if (phase.kind === "archive") {
    return <ArchivedCopyView {...phase.copy} />;
  }
  return (
    <CheckingLink
      host={host}
      onOpenOriginal={() => {
        if (original) {
          leaveFor(original);
        }
      }}
      original={original}
      slow={slow}
      visible={visible}
    />
  );
}
