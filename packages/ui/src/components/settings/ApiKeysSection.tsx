import { useState } from "react";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import {
  type ApiKeyListItem,
  ApiKeysDialog,
  type CreatedApiKey,
} from "./ApiKeysDialog";
import { SettingRow } from "./SettingRow";

interface ApiKeysSectionProps {
  isLoading: boolean;
  keys: ApiKeyListItem[] | undefined;
  onCreateKey: () => Promise<CreatedApiKey | null>;
  onRevokeKey: (keyId: string) => Promise<void>;
  onRotateKey: (keyId: string) => Promise<CreatedApiKey | null>;
}

export function ApiKeysSection({
  isLoading,
  keys,
  onCreateKey,
  onRevokeKey,
  onRotateKey,
}: ApiKeysSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingRow title="API Keys">
        {isLoading ? (
          <Button disabled size="sm" variant="ghost">
            <Spinner />
          </Button>
        ) : (
          <Button onClick={() => setOpen(true)} size="sm" variant="link">
            Manage
          </Button>
        )}
      </SettingRow>

      <ApiKeysDialog
        isLoading={isLoading}
        keys={keys}
        onCreateKey={onCreateKey}
        onOpenChange={setOpen}
        onRevokeKey={onRevokeKey}
        onRotateKey={onRotateKey}
        open={open}
      />
    </>
  );
}
