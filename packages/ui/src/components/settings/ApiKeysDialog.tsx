import { Copy, KeyRound, RotateCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

export interface ApiKeyListItem {
  id: string;
  name: string;
  maskedKey: string;
  source: "component" | "legacy";
  status: "active" | "disabled" | "rotating" | "expired" | "exhausted";
  requiresUpdate: boolean;
  createdAt: number;
  lastUsedAt?: number;
}

export interface CreatedApiKey {
  id?: string;
  key: string;
}

interface ApiKeysDialogProps {
  isLoading: boolean;
  keys: ApiKeyListItem[] | undefined;
  onCreateKey: () => Promise<CreatedApiKey | null>;
  onOpenChange: (open: boolean) => void;
  onRevokeKey: (
    keyId: string,
    source: ApiKeyListItem["source"]
  ) => Promise<void>;
  onRotateKey: (keyId: string) => Promise<CreatedApiKey | null>;
  open: boolean;
}

const formatDate = (value?: number) => {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const getStatusVariant = (
  status: ApiKeyListItem["status"]
): "default" | "outline" | "secondary" =>
  status === "active"
    ? "outline"
    : status === "disabled"
      ? "secondary"
      : "outline";

const formatStatus = (status: ApiKeyListItem["status"]) =>
  status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const formatKeyName = (name: string) =>
  name === "API Keys" ? "Default API key" : name;

export function ApiKeysDialog({
  isLoading,
  keys,
  onCreateKey,
  onOpenChange,
  onRevokeKey,
  onRotateKey,
  open,
}: ApiKeysDialogProps) {
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const isCreatingRef = useRef(false);

  const handleCreate = async () => {
    if (isCreatingRef.current) {
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setRevealedKey(null);
    const toastId = toast.loading("Generating API key...");
    try {
      const created = await onCreateKey();
      if (created) {
        setRevealedKey(created);
        toast.success("API key generated. Copy it now.", { id: toastId });
      }
    } catch {
      toast.error("Failed to generate API key.", { id: toastId });
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!revealedKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(revealedKey.key);
      toast.success("API key copied.");
    } catch {
      toast.error("Could not copy API key.");
    }
  };

  const runKeyAction = async (
    keyId: string,
    action: () => Promise<void | CreatedApiKey | null>,
    successMessage: string
  ) => {
    setActionKey(keyId);
    const toastId = toast.loading("Updating API key...");
    try {
      const result = await action();
      if (result?.key) {
        setRevealedKey(result);
      }
      toast.success(successMessage, { id: toastId });
    } catch {
      toast.error("Could not update API key.", { id: toastId });
    } finally {
      setActionKey(null);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[82vh] gap-3 overflow-y-auto p-4 sm:max-w-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <DialogHeader className="gap-1">
            <DialogTitle>Manage API Keys</DialogTitle>
            <DialogDescription>
              {keys?.length ? `${keys.length} keys` : "No keys yet"} for API,
              MCP, and Raycast access.
            </DialogDescription>
          </DialogHeader>

          <Button
            className="shrink-0"
            disabled={isCreating}
            onClick={handleCreate}
            size="sm"
          >
            {isCreating ? <Spinner /> : <KeyRound />}
            Generate Key
          </Button>
        </div>

        <div className="space-y-3">
          {revealedKey && (
            <div
              className="space-y-2 rounded-md border p-2.5"
              key={revealedKey.id ?? revealedKey.key}
            >
              <div className="font-medium text-sm">Copy your new key now</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  key={revealedKey.id ?? revealedKey.key}
                  readOnly
                  value={revealedKey.key}
                />
                <Button onClick={handleCopy} size="sm" variant="secondary">
                  <Copy />
                  Copy
                </Button>
              </div>
            </div>
          )}

          <div className="divide-y rounded-md border">
            {isLoading && (
              <div className="flex items-center justify-center p-6">
                <Spinner />
              </div>
            )}

            {!isLoading && (!keys || keys.length === 0) && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Generate your first API key to connect external tools.
              </div>
            )}

            {keys?.map((key) => {
              const isBusy = actionKey === key.id;
              const canRotate =
                key.source === "component" &&
                (key.status === "active" || key.status === "disabled");

              return (
                <div
                  className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between"
                  key={`${key.source}-${key.id}`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">
                        {formatKeyName(key.name)}
                      </span>
                      {key.status !== "active" && (
                        <Badge variant={getStatusVariant(key.status)}>
                          {formatStatus(key.status)}
                        </Badge>
                      )}
                      {key.requiresUpdate && <Badge>Update required</Badge>}
                    </div>
                    <div className="break-all font-mono text-muted-foreground text-xs">
                      {key.maskedKey}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Last used: {formatDate(key.lastUsedAt)}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                    {canRotate && (
                      <Button
                        disabled={isBusy}
                        onClick={() =>
                          runKeyAction(
                            key.id,
                            () => onRotateKey(key.id),
                            "API key regenerated. Copy the new key now."
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        {isBusy ? <Spinner /> : <RotateCw />}
                        Regenerate
                      </Button>
                    )}

                    <Button
                      disabled={isBusy}
                      onClick={() =>
                        runKeyAction(
                          key.id,
                          () => onRevokeKey(key.id, key.source),
                          "API key revoked."
                        )
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {isBusy ? <Spinner /> : <Trash2 />}
                      Revoke
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
