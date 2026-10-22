import { Copy, KeyRound, RotateCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  SettingsEmptyState,
  SettingsIconTile,
  SettingsList,
  SettingsListSkeleton,
} from "./SettingsDialog";

export interface ApiKeyListItem {
  createdAt: number;
  id: string;
  lastUsedAt?: number;
  maskedKey: string;
  name: string;
  status: "active" | "disabled" | "rotating" | "expired" | "exhausted";
}

export interface CreatedApiKey {
  id?: string;
  key: string;
}

type PendingConfirm =
  | { kind: "revoke" | "rotate"; item: ApiKeyListItem }
  | { kind: "revokeAll" };

/** The confirmation each destructive key action asks for. */
export function apiKeyConfirmCopy(pending: PendingConfirm) {
  if (pending.kind === "revokeAll") {
    return {
      title: "Revoke all API keys?",
      description:
        "Every API key stops working right away, including keys used by the CLI, Raycast and MCP clients. This can’t be undone.",
      confirmLabel: "Revoke all keys",
    };
  }
  const label = visibleKeyName(pending.item.name) ?? pending.item.maskedKey;
  return pending.kind === "revoke"
    ? {
        title: "Revoke this API key?",
        description: `${label} stops working right away. Anything that uses it loses access to your library. This can’t be undone.`,
        confirmLabel: "Revoke key",
      }
    : {
        title: "Regenerate this API key?",
        description: `${label} stops working right away and is replaced by a new key. Update anything that uses it with the new key.`,
        confirmLabel: "Regenerate key",
      };
}

/**
 * The one-time reveals after an action: a revoked or regenerated key's reveal
 * goes away, and every other new key stays on screen until the dialog closes.
 */
export function nextRevealedKeys(
  revealed: CreatedApiKey[],
  action:
    | { kind: "created"; key: CreatedApiKey }
    | { kind: "rotated"; keyId: string; key: CreatedApiKey }
    | { kind: "revoked"; keyId: string }
    | { kind: "revokedAll" }
): CreatedApiKey[] {
  switch (action.kind) {
    case "created":
      return [action.key, ...revealed];
    case "rotated":
      return [action.key, ...revealed.filter((key) => key.id !== action.keyId)];
    case "revoked":
      return revealed.filter((key) => key.id !== action.keyId);
    default:
      return [];
  }
}

interface ApiKeysPanelProps {
  isLoading: boolean;
  keys: ApiKeyListItem[] | undefined;
  onCreateKey: () => Promise<CreatedApiKey | null>;
  onRevokeAllKeys?: () => Promise<{ hasMore: boolean; revokedCount: number }>;
  onRevokeKey: (keyId: string) => Promise<void>;
  onRotateKey: (keyId: string) => Promise<CreatedApiKey | null>;
}

interface ApiKeysDialogProps extends ApiKeysPanelProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const visibleKeyName = (name: string) => {
  const trimmed = name.trim();
  return ["", "API Keys", "Default API key"].includes(trimmed) ? null : trimmed;
};

function ApiKeyRow({
  item,
  busy,
  disabled,
  onRotate,
  onRevoke,
}: {
  item: ApiKeyListItem;
  busy: boolean;
  disabled: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const name = visibleKeyName(item.name);
  const identity = [
    name,
    item.maskedKey,
    `created ${dateFormatter.format(item.createdAt)}`,
  ]
    .filter(Boolean)
    .join(", ");
  const canRotate = item.status === "active" || item.status === "disabled";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <SettingsIconTile icon={KeyRound} />
      <div className="min-w-0 flex-1">
        {name ? <p className="truncate font-medium text-sm">{name}</p> : null}
        <p
          className={
            name
              ? "truncate font-mono text-muted-foreground text-xs leading-5"
              : "truncate font-mono text-[13px] leading-5"
          }
        >
          {item.maskedKey}
        </p>
        <p className="text-muted-foreground text-xs leading-5">
          Created {dateFormatter.format(item.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center text-muted-foreground">
        {canRotate ? (
          <Button
            aria-label={`Regenerate ${identity}`}
            disabled={disabled}
            onClick={onRotate}
            size="icon"
            title="Regenerate key"
            variant="ghost"
          >
            {busy ? <Spinner /> : <RotateCw />}
          </Button>
        ) : null}
        <Button
          aria-label={`Revoke ${identity}`}
          disabled={disabled}
          onClick={onRevoke}
          size="icon"
          title="Revoke key"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function RevealedKey({ value, onCopy }: { value: string; onCopy: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
      <p className="font-medium text-sm">Copy your new key now</p>
      <div className="flex gap-2">
        <Input
          aria-label="New API key"
          className="bg-background font-mono md:text-xs"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={value}
        />
        <Button onClick={onCopy} variant="outline">
          <Copy />
          Copy
        </Button>
      </div>
    </div>
  );
}

export function ApiKeysPanel({
  isLoading,
  keys,
  onCreateKey,
  onRevokeAllKeys,
  onRevokeKey,
  onRotateKey,
}: ApiKeysPanelProps) {
  const [revealedKeys, setRevealedKeys] = useState<CreatedApiKey[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const actionInFlight = useRef<boolean>(false);

  const perform = async (id: string, action: () => Promise<string>) => {
    if (actionInFlight.current) {
      return;
    }
    actionInFlight.current = true;
    setBusy(id);
    setFeedback(null);
    try {
      setFeedback({ message: await action(), error: false });
    } catch {
      setFeedback({
        message: "Could not update your API keys. Please try again.",
        error: true,
      });
    } finally {
      actionInFlight.current = false;
      setBusy(null);
    }
  };

  const create = () =>
    perform("create", async () => {
      const key = await onCreateKey();
      if (!key) {
        throw new Error("No API key returned");
      }
      setRevealedKeys((current) =>
        nextRevealedKeys(current, { kind: "created", key })
      );
      return "API key created. Copy it now; it is only shown once.";
    });
  const revokeAll = () =>
    perform("all", async () => {
      if (!onRevokeAllKeys) {
        return "";
      }
      const result = await onRevokeAllKeys();
      setRevealedKeys((current) =>
        nextRevealedKeys(current, { kind: "revokedAll" })
      );
      return result.hasMore
        ? "Revoking remaining keys in the background."
        : "All API keys revoked.";
    });
  const revoke = (item: ApiKeyListItem) =>
    perform(item.id, async () => {
      await onRevokeKey(item.id);
      setRevealedKeys((current) =>
        nextRevealedKeys(current, { kind: "revoked", keyId: item.id })
      );
      return "API key revoked.";
    });
  const rotate = (item: ApiKeyListItem) =>
    perform(item.id, async () => {
      const key = await onRotateKey(item.id);
      if (!key) {
        throw new Error("No API key returned");
      }
      setRevealedKeys((current) =>
        nextRevealedKeys(current, { kind: "rotated", keyId: item.id, key })
      );
      return "API key regenerated. Copy the new key now.";
    });
  const confirm = (pending: PendingConfirm) => {
    setPendingConfirm(pending);
    setConfirmOpen(true);
  };
  const runConfirmed = () => {
    if (!pendingConfirm) {
      return;
    }
    if (pendingConfirm.kind === "revokeAll") {
      void revokeAll();
    } else if (pendingConfirm.kind === "revoke") {
      void revoke(pendingConfirm.item);
    } else {
      void rotate(pendingConfirm.item);
    }
  };
  const copy = async (revealedKey: CreatedApiKey) => {
    try {
      await navigator.clipboard.writeText(revealedKey.key);
      setFeedback({ message: "API key copied.", error: false });
    } catch {
      setFeedback({
        message: "Could not copy the key. Select and copy it manually.",
        error: true,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-muted-foreground text-xs leading-5">
          Keys have full access to your library. You can keep up to 10 active
          keys.
        </p>
        <Button
          className="shrink-0"
          disabled={isLoading || busy !== null}
          onClick={() => void create()}
          size="sm"
        >
          {busy === "create" ? <Spinner /> : null}Create key
        </Button>
      </div>
      {feedback ? (
        <p
          className={
            feedback.error
              ? "text-destructive text-xs leading-5"
              : "text-muted-foreground text-xs leading-5"
          }
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
      {revealedKeys.map((revealedKey) => (
        <RevealedKey
          key={revealedKey.id ?? revealedKey.key}
          onCopy={() => void copy(revealedKey)}
          value={revealedKey.key}
        />
      ))}
      {isLoading ? (
        <SettingsListSkeleton label="Loading API keys…" rows={2} />
      ) : null}
      {!isLoading && keys?.length === 0 ? (
        <SettingsEmptyState>
          Create your first API key to connect external tools.
        </SettingsEmptyState>
      ) : null}
      {keys?.length ? (
        <SettingsList>
          {keys.map((item) => (
            <ApiKeyRow
              busy={busy === item.id}
              disabled={busy !== null}
              item={item}
              key={item.id}
              onRevoke={() => confirm({ kind: "revoke", item })}
              onRotate={() => confirm({ kind: "rotate", item })}
            />
          ))}
        </SettingsList>
      ) : null}
      {onRevokeAllKeys && keys?.length ? (
        <div className="flex justify-end">
          <Button
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy !== null}
            onClick={() => confirm({ kind: "revokeAll" })}
            size="sm"
            variant="ghost"
          >
            {busy === "all" ? <Spinner /> : null}Revoke all keys
          </Button>
        </div>
      ) : null}
      {pendingConfirm ? (
        <ConfirmDialog
          {...apiKeyConfirmCopy(pendingConfirm)}
          onConfirm={runConfirmed}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
        />
      ) : null}
    </div>
  );
}

export function ApiKeysDialog({
  open,
  onOpenChange,
  ...props
}: ApiKeysDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API keys</DialogTitle>
        </DialogHeader>
        <ApiKeysPanel {...props} />
      </DialogContent>
    </Dialog>
  );
}
