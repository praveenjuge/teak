"use client";

import { api } from "@teak/convex";
import { Badge } from "@teak/ui/components/ui/badge";
import { Button } from "@teak/ui/components/ui/button";
import { CardTitle } from "@teak/ui/components/ui/card";
import { Input } from "@teak/ui/components/ui/input";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { TOAST_IDS } from "@/lib/toastConfig";

type ApiKeyListItem = {
  id: string;
};

type CreatedApiKey = {
  key: string;
};

const convexApi = api as any;

export function ApiKeysSection() {
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const keys = useQuery(convexApi.apiKeys.listUserApiKeys, {}) as
    | ApiKeyListItem[]
    | undefined;
  const createKey = useMutation(convexApi.apiKeys.createUserApiKey);

  const isLoading = keys === undefined;
  const activeKey = keys?.[0] ?? null;

  const handleCreateOrRotate = async () => {
    setIsCreating(true);
    const toastId = toast.loading("Generating API key...", {
      id: TOAST_IDS.apiKeyCreate,
    });
    try {
      const created = (await createKey({
        name: "API Keys",
      })) as CreatedApiKey;
      setRevealedKey(created.key);
      toast.success(
        "API key generated. Copy it now, it won't be shown again.",
        {
          id: toastId,
        }
      );
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
