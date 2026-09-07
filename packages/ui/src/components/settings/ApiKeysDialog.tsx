import { Copy, RotateCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

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
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        {name ? <p className="truncate font-medium text-sm">{name}</p> : null}
        <p className="truncate font-mono text-muted-foreground text-xs">
          {item.maskedKey}
        </p>
        <p className="text-muted-foreground text-xs">
          Created {dateFormatter.format(item.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
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
    <div className="space-y-2">
      <p className="font-medium text-sm">Copy your new key now</p>
      <div className="flex gap-2">
        <Input aria-label="New API key" readOnly value={value} />
        <Button onClick={onCopy} size="sm" variant="secondary">
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
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const actionInFlight = useRef(false);

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
      setRevealedKey(null);
      const key = await onCreateKey();
      if (!key) {
        throw new Error("No API key returned");
      }
      setRevealedKey(key);
      return "API key created. Copy it now; it is only shown once.";
    });
  const revokeAll = () =>
    perform("all", async () => {
      if (!onRevokeAllKeys) {
        return "";
      }
      const result = await onRevokeAllKeys();
      setRevealedKey(null);
      return result.hasMore
        ? "Revoking remaining keys in the background."
        : "All API keys revoked.";
    });
  const copy = async () => {
    if (!revealedKey) {
      return;
    }
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
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <Button
          disabled={isLoading || busy !== null}
          onClick={() => void create()}
          size="sm"
        >
          {busy === "create" ? <Spinner /> : null}Create key
        </Button>
        {onRevokeAllKeys && keys?.length ? (
          <Button
            disabled={busy !== null}
            onClick={() => void revokeAll()}
            size="sm"
            variant="ghost"
          >
            {busy === "all" ? <Spinner /> : null}Revoke all keys
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Keys have full access to your library. You can keep up to 10 active
        keys.
      </p>
      {feedback ? (
        <p
          className={
            feedback.error
              ? "text-destructive text-sm"
              : "text-muted-foreground text-sm"
          }
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
      {revealedKey ? (
        <RevealedKey onCopy={() => void copy()} value={revealedKey.key} />
      ) : null}
      {isLoading ? (
        <p className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
          <Spinner />
          Loading API keys…
        </p>
      ) : null}
      {!isLoading && keys?.length === 0 ? (
        <p className="py-6 text-muted-foreground text-sm">
          Create your first API key to connect external tools.
        </p>
      ) : null}
      <ul className="divide-y">
        {keys?.map((item) => (
          <ApiKeyRow
            busy={busy === item.id}
            disabled={busy !== null}
            item={item}
            key={item.id}
            onRevoke={() =>
              void perform(item.id, async () => {
                await onRevokeKey(item.id);
                setRevealedKey(null);
                return "API key revoked.";
              })
            }
            onRotate={() =>
              void perform(item.id, async () => {
                const key = await onRotateKey(item.id);
                if (!key) {
                  throw new Error("No API key returned");
                }
                setRevealedKey(key);
                return "API key regenerated. Copy the new key now.";
              })
            }
          />
        ))}
      </ul>
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
