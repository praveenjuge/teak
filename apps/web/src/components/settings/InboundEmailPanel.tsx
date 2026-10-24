"use client";

import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy } from "vadivam-react";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { formatRelativeTime } from "./importExportFormat";
import { SettingsSection } from "./SettingsSection";

/** What `inbound.settings.getMine` returns for the signed-in account. */
export interface InboundEmailState {
  address: string;
  enabled: boolean;
  lastReceivedAt: number | null;
  sender: string;
  /** Mail is saved only from a verified sign-in email. */
  senderVerified: boolean;
}

export interface InboundEmailPanelProps {
  onDisable: () => Promise<unknown>;
  onEnable: () => Promise<unknown>;
  /** `undefined` while loading; `null` when it can't be shown. */
  state: InboundEmailState | null | undefined;
}

const isRateLimited = (error: unknown) =>
  (error as { data?: { code?: unknown } } | null)?.data?.code ===
  "RATE_LIMITED";

const senderName = (chunks: ReactNode) => (
  <span className="font-medium">{chunks}</span>
);

/**
 * The address cut before its `@` on narrow screens: the name gives way to an
 * ellipsis and the domain always shows.
 */
function MiddleTruncatedAddress({ address }: { address: string }) {
  const at = address.lastIndexOf("@");
  const middle = at > 0 ? at : Math.ceil(address.length / 2);
  return (
    <span
      className="flex h-9 min-w-0 flex-1 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm"
      data-slot="inbound-address"
      title={address}
    >
      <span className="min-w-0 truncate">{address.slice(0, middle)}</span>
      <span className="shrink-0">{address.slice(middle)}</span>
    </span>
  );
}

/** Settings → Integrations → Save by email: its switch and, when on, the address. */
export function InboundEmailSection({
  onDisable,
  onEnable,
  state,
}: InboundEmailPanelProps) {
  const t = useTranslations("settings.inboundEmail");
  const tc = useTranslations("common");
  const tFormat = useTranslations("settings.format");
  const tIntegrations = useTranslations("settings.integrations");
  const locale = useIntlLocale();
  const [busy, setBusy] = useState<"enable" | "disable" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<boolean>(false);

  const run = async (
    action: "enable" | "disable",
    change: () => Promise<unknown>
  ) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setBusy(action);
    setError(null);
    try {
      await change();
    } catch (caught) {
      setError(t(isRateLimited(caught) ? "rateLimited" : "genericError"));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success(t("addressCopied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const intro = t("intro");
  const section = (props: {
    action?: ReactNode;
    children?: ReactNode;
    description?: ReactNode;
  }) => (
    <SettingsSection
      action={props.action}
      description={props.description ?? intro}
      id="save-by-email"
      title={tIntegrations("saveByEmailTitle")}
    >
      {props.children}
    </SettingsSection>
  );

  if (state === undefined) {
    return section({
      action: (
        <span
          aria-busy="true"
          className="block h-8 w-20 animate-pulse rounded-full bg-muted"
          role="status"
        >
          <span className="sr-only">{t("loading")}</span>
        </span>
      ),
    });
  }

  const errorLine = error ? (
    <p className="text-destructive text-xs leading-5" role="alert">
      {error}
    </p>
  ) : null;

  if (!state?.enabled) {
    const unverified = state ? !state.senderVerified : false;
    return section({
      action: (
        <Button
          disabled={state === null || unverified || busy !== null}
          onClick={() => void run("enable", onEnable)}
          size="sm"
        >
          {busy === "enable" ? <Spinner /> : null}
          {t("turnOn")}
        </Button>
      ),
      description: unverified
        ? t.rich("verifyToTurnOn", {
            sender: state?.sender ?? "",
            strong: senderName,
          })
        : intro,
      children: errorLine,
    });
  }

  const lastReceived =
    state.lastReceivedAt === null
      ? null
      : t("lastReceived", {
          when: formatRelativeTime(
            state.lastReceivedAt,
            Date.now(),
            tFormat,
            locale
          ),
        });

  return section({
    action: (
      <Button
        disabled={busy !== null}
        onClick={() => void run("disable", onDisable)}
        size="sm"
        variant="outline"
      >
        {busy === "disable" ? <Spinner /> : null}
        {t("turnOff")}
      </Button>
    ),
    children: (
      <div className="space-y-2">
        <div className="flex min-w-0 gap-2">
          <MiddleTruncatedAddress address={state.address} />
          <Button
            aria-label={t("copyAddress")}
            onClick={() => void copy(state.address)}
            variant="outline"
          >
            <Copy />
            {tc("copy")}
          </Button>
        </div>
        <p className="flex flex-wrap gap-x-2 text-[13px] text-muted-foreground leading-5">
          <span>
            {t.rich(state.senderVerified ? "sendFrom" : "unverified", {
              sender: state.sender,
              strong: senderName,
            })}
          </span>
          {lastReceived ? <span>{lastReceived}</span> : null}
        </p>
        {errorLine}
      </div>
    ),
  });
}
