import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

interface ApiKeyListItem {
  id: string;
}

interface CreatedApiKey {
  key: string;
}

interface ApiKeysSectionProps {
  isLoading: boolean;
  keys: ApiKeyListItem[] | undefined;
  onCreateKey: () => Promise<CreatedApiKey | null>;
}

export function ApiKeysSection({
  keys,
  isLoading,
  onCreateKey,
}: ApiKeysSectionProps) {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const activeKey = keys?.[0] ?? null;

  const handleCreateOrRotate = async () => {
    setIsCreating(true);
    const toastId = toast.loading("Generating API key...");
    try {
      const created = await onCreateKey();
      if (created) {
        setRevealedKey(created.key);
        toast.success(
          "API key generated. Copy it now, it won't be shown again.",
          {
            id: toastId,
          }
        );
      }
    } catch {
      toast.error("Failed to generate API key.", {
        id: toastId,
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!revealedKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(revealedKey);
      toast.success("API key copied.");
    } catch {
      toast.error("Could not copy API key.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>API Keys</CardTitle>
        <div className="-mx-2.5 flex items-center justify-end gap-2 -space-x-2.5">
          {isLoading ? (
            <Button disabled size="sm" variant="ghost">
              <Spinner />
            </Button>
          ) : (
            <>
              {activeKey && <Badge variant="outline">Active</Badge>}
              <Button
                disabled={isCreating}
                onClick={handleCreateOrRotate}
                size="sm"
                type="button"
                variant="link"
              >
                {isCreating
                  ? "Generating..."
                  : activeKey
                    ? "Regenerate"
                    : "Generate"}
              </Button>
            </>
          )}
        </div>
      </div>

      {revealedKey && (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={revealedKey} />
            <Button
              onClick={handleCopy}
              size="sm"
              type="button"
              variant="secondary"
            >
              Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export type { ApiKeyListItem, CreatedApiKey };
