import { Copy, RotateCw, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

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

interface ApiKeysDialogProps {
  isLoading: boolean;
  keys: ApiKeyListItem[] | undefined;
  onCreateKey: () => Promise<CreatedApiKey | null>;
  onOpenChange: (open: boolean) => void;
  onRevokeKey: (keyId: string) => Promise<void>;
  onRotateKey: (keyId: string) => Promise<CreatedApiKey | null>;
  open: boolean;
}

const apiKeyDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatDate = (value?: number) => {
  if (!value) {
    return "Never";
  }

  return apiKeyDateFormatter.format(new Date(value));
};

const visibleKeyName = (name: string) => {
  const trimmed = name.trim();
  if (
    trimmed === "" ||
    trimmed === "API Keys" ||
    trimmed === "Default API key"
  ) {
    return null;
  }
  return trimmed;
};

function ActionTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[calc(100%+0.375rem)] left-1/2 z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

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
    action: () => Promise<CreatedApiKey | null | undefined>,
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
      <DialogContent className="max-h-[82vh] gap-3 overflow-y-auto p-4 sm:max-w-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <DialogHeader>
            <DialogTitle>Manage API Keys</DialogTitle>
          </DialogHeader>

          <Button
            className="shrink-0"
            disabled={isCreating}
            onClick={handleCreate}
            size="sm"
          >
            {isCreating ? <Spinner /> : null}
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

          <div className="rounded-md border">
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

            {keys && keys.length > 0 ? (
              <table className="w-full table-fixed caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[58%]">Key</TableHead>
                    <TableHead className="w-[26%]">Used</TableHead>
                    <TableHead className="w-[16%]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => {
                    const isBusy = actionKey === key.id;
                    const canRotate =
                      key.status === "active" || key.status === "disabled";
                    const label = visibleKeyName(key.name);
                    const keyIdentity = [
                      label,
                      key.maskedKey,
                      `created ${formatDate(key.createdAt)}`,
                    ]
                      .filter(Boolean)
                      .join(", ");

                    return (
                      <TableRow key={key.id}>
                        <TableCell className="max-w-0 py-3 pr-2 pl-3">
                          {label ? (
                            <div className="truncate font-medium text-foreground text-sm">
                              {label}
                            </div>
                          ) : null}
                          <div className="truncate font-mono text-muted-foreground text-xs">
                            {key.maskedKey}
                          </div>
                          <div className="truncate text-muted-foreground text-xs">
                            Created {formatDate(key.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-2 text-muted-foreground">
                          {formatDate(key.lastUsedAt)}
                        </TableCell>
                        <TableCell className="pr-3 pl-2">
                          <div className="flex justify-end gap-1.5">
                            {canRotate && (
                              <ActionTooltip label="Regenerate key">
                                <Button
                                  aria-label={`Regenerate ${keyIdentity}`}
                                  className="size-8"
                                  disabled={isBusy}
                                  onClick={() =>
                                    runKeyAction(
                                      key.id,
                                      () => onRotateKey(key.id),
                                      "API key regenerated. Copy the new key now."
                                    )
                                  }
                                  size="icon"
                                  type="button"
                                  variant="outline"
                                >
                                  {isBusy ? <Spinner /> : <RotateCw />}
                                </Button>
                              </ActionTooltip>
                            )}

                            <ActionTooltip label="Revoke key">
                              <Button
                                aria-label={`Revoke ${keyIdentity}`}
                                className="size-8"
                                disabled={isBusy}
                                onClick={() =>
                                  runKeyAction(
                                    key.id,
                                    async () => {
                                      await onRevokeKey(key.id);
                                      return;
                                    },
                                    "API key revoked."
                                  )
                                }
                                size="icon"
                                type="button"
                                variant="ghost"
                              >
                                {isBusy ? <Spinner /> : <Trash2 />}
                              </Button>
                            </ActionTooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
