"use client";

import { Copy, Mail } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { formatRelativeTime } from "./importExportFormat";
import { SettingRow, SettingValueSkeleton } from "./SettingRow";
import { SettingsDialog, SettingsDialogBody } from "./SettingsDialog";

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

const GENERIC_ERROR = "Couldn't update Save by email. Try again.";
const RATE_LIMITED_ERROR = "Too many changes. Try again in a minute.";

const errorMessage = (error: unknown) =>
  (error as { data?: { code?: unknown } } | null)?.data?.code === "RATE_LIMITED"
    ? RATE_LIMITED_ERROR
    : GENERIC_ERROR;

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

export function InboundEmailPanel({
  onDisable,
  onEnable,
  state,
}: InboundEmailPanelProps) {
  const [busy, setBusy] = useState<"enable" | "disable" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

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
      setError(errorMessage(caught));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy the address. Select and copy it manually.");
    }
  };

  if (state === undefined) {
    return (
      <div aria-busy="true" className="space-y-3" role="status">
        <span className="sr-only">Loading Save by email…</span>
        <div aria-hidden className="flex gap-2">
          <span className="h-9 flex-1 animate-pulse rounded-md bg-muted" />
          <span className="h-9 w-20 animate-pulse rounded-md bg-muted" />
        </div>
        <span
          aria-hidden
          className="block h-3 w-3/5 animate-pulse rounded-full bg-muted"
        />
      </div>
    );
  }

  const errorLine = error ? (
    <p className="text-destructive text-xs leading-5" role="alert">
      {error}
    </p>
  ) : null;

  if (!state?.enabled) {
    const unverified = state ? !state.senderVerified : false;
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm leading-5">
          Send or forward email to Teak, and it's saved as cards.
        </p>
        {unverified ? (
          <p className="text-sm leading-5">
            Verify your sign-in email,{" "}
            <span className="font-medium">{state?.sender}</span>, to turn this
            on.
          </p>
        ) : null}
        {errorLine}
        <Button
          className="w-full"
          disabled={state === null || unverified || busy !== null}
          onClick={() => void run("enable", onEnable)}
        >
          {busy === "enable" ? <Spinner /> : null}Turn on
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 gap-2">
        <MiddleTruncatedAddress address={state.address} />
        <Button
          aria-label="Copy address"
          onClick={() => void copy(state.address)}
          variant="outline"
        >
          <Copy />
          Copy
        </Button>
      </div>
      <p className="text-sm leading-5">
        Send from <span className="font-medium">{state.sender}</span>. Mail from
        other addresses isn't saved.
      </p>
      <p className="text-muted-foreground text-sm leading-5">
        Forward or send anything. An email with a single link becomes a link
        card, everything else becomes a note, and attachments become their own
        cards. All are tagged email.
      </p>
      {state.lastReceivedAt === null ? null : (
        <p className="text-muted-foreground text-xs leading-5">
          Last email received {formatRelativeTime(state.lastReceivedAt)}
        </p>
      )}
      {errorLine}
      <div className="flex justify-end">
        <Button
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={busy !== null}
          onClick={() => void run("disable", onDisable)}
          size="sm"
          variant="ghost"
        >
          {busy === "disable" ? <Spinner /> : null}Turn off
        </Button>
      </div>
    </div>
  );
}

export function InboundEmailDialog({
  onOpenChange,
  open,
  ...panel
}: InboundEmailPanelProps & {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <SettingsDialog
      icon={Mail}
      onOpenChange={onOpenChange}
      open={open}
      title="Save by email"
    >
      <SettingsDialogBody>
        <InboundEmailPanel {...panel} />
      </SettingsDialogBody>
    </SettingsDialog>
  );
}

/** The Settings row: whether Save by email is on, and its dialog. */
export function InboundEmailSection(props: InboundEmailPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow title="Save by email">
        {props.state === undefined ? (
          <SettingValueSkeleton className="w-10" />
        ) : (
          <Button
            aria-label={`Save by email: ${props.state?.enabled ? "On" : "Off"}`}
            disabled={props.state === null}
            onClick={() => setOpen(true)}
            size="sm"
            variant="link"
          >
            {props.state?.enabled ? "On" : "Off"}
          </Button>
        )}
      </SettingRow>
      <InboundEmailDialog {...props} onOpenChange={setOpen} open={open} />
    </>
  );
}
