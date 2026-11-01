import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useEffect, useRef, useState } from "react";
import { Copy, KeyRound, RotateCw, Trash } from "vadivam-react";
import { useLocalDateFormat } from "../../hooks/useLocalDateFormat";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsListSkeleton,
} from "./SettingsDialog";
import { SettingsSection, SettingsTile } from "./SettingsSection";

const API_DOCS_URL = "https://teakvault.com/docs/api";
const CREATED_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

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

type ApiKeysTranslator = TeakTranslator<"settings.apiKeys">;

export function apiKeyConfirmCopy(
  pending: PendingConfirm,
  t: ApiKeysTranslator
) {
  if (pending.kind === "revokeAll") {
    return {
      title: t("revokeAllTitle"),
      description: t("revokeAllDescription"),
      confirmLabel: t("revokeAllConfirm"),
    };
  }
  const key = visibleKeyName(pending.item.name) ?? pending.item.maskedKey;
  return pending.kind === "revoke"
    ? {
        title: t("revokeTitle"),
        description: t("revokeDescription", { key }),
        confirmLabel: t("revokeConfirm"),
      }
    : {
        title: t("regenerateTitle"),
        description: t("regenerateDescription", { key }),
        confirmLabel: t("regenerateConfirm"),
      };
}

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

/** Matches the server's cap (`API_KEY_NAME_MAX_LENGTH` in `apiKeys.ts`). */
export const API_KEY_NAME_MAX_LENGTH = 64;

/**
 * Where focus goes once a revoked key leaves the list: the key that took its
 * place, else the one above it, else `null` (no keys left).
 */
export function focusIndexAfterRemoval(
  removedIndex: number,
  remaining: number
): number | null {
  if (remaining === 0) {
    return null;
  }
  return Math.min(removedIndex, remaining - 1);
}

interface ApiKeysPanelProps {
  isLoading: boolean;
  keys: ApiKeyListItem[] | undefined;
  onCreateKey: (name?: string) => Promise<CreatedApiKey | null>;
  onRevokeAllKeys?: () => Promise<{ hasMore: boolean; revokedCount: number }>;
  onRevokeKey: (keyId: string) => Promise<void>;
  onRotateKey: (keyId: string) => Promise<CreatedApiKey | null>;
}

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
  const t = useTranslations("settings.apiKeys");
  const formatDate = useLocalDateFormat(CREATED_FORMAT);
  const createdAt = formatDate?.(item.createdAt);
  const name = visibleKeyName(item.name);
  const identity = [
    name,
    item.maskedKey,
    createdAt && t("identityCreated", { date: createdAt }),
  ]
    .filter(Boolean)
    .join(", ");
  const canRotate = item.status === "active" || item.status === "disabled";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <SettingsTile icon={KeyRound} />
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
          {createdAt ? t("created", { date: createdAt }) : "\u00a0"}
        </p>
      </div>
      <div className="flex shrink-0 items-center text-muted-foreground">
        {canRotate ? (
          <Button
            aria-label={t("regenerateLabel", { identity })}
            disabled={disabled}
            onClick={onRotate}
            size="icon"
            title={t("regenerateKey")}
            variant="ghost"
          >
            {busy ? <Spinner /> : <RotateCw />}
          </Button>
        ) : null}
        <Button
          aria-label={t("revokeLabel", { identity })}
          data-api-key-revoke=""
          disabled={disabled}
          onClick={onRevoke}
          size="icon"
          title={t("revokeKey")}
          variant="ghost"
        >
          <Trash />
        </Button>
      </div>
    </li>
  );
}

function RevealedKey({ value, onCopy }: { value: string; onCopy: () => void }) {
  const t = useTranslations("settings.apiKeys");
  const tc = useTranslations("common");
  return (
    <div className="space-y-2.5 bg-muted/40 px-4 py-3">
      <p className="font-medium text-sm">{t("copyNewKey")}</p>
      <div className="flex gap-2">
        <Input
          aria-label={t("newKeyLabel")}
          className="bg-background font-mono md:text-xs"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={value}
        />
        <Button onClick={onCopy} variant="outline">
          <Copy />
          {tc("copy")}
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
  const t = useTranslations("settings.apiKeys");
  const tIntegrations = useTranslations("settings.integrations");
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
  const [newKeyName, setNewKeyName] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  // The revoked key's row and its Revoke button leave the list, which would
  // drop focus to the page; this says where it was.
  const revokedFocus = useRef<{ id: string; index: number } | null>(null);

  useEffect(() => {
    const pending = revokedFocus.current;
    if (!(pending && keys) || busy !== null) {
      return;
    }
    if (keys.some((key) => key.id === pending.id)) {
      return;
    }
    revokedFocus.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(
      "[data-api-key-revoke]"
    );
    const index = focusIndexAfterRemoval(pending.index, buttons?.length ?? 0);
    (index === null ? createButtonRef.current : buttons?.[index])?.focus();
  }, [keys, busy]);

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
        message: t("updateFailed"),
        error: true,
      });
    } finally {
      actionInFlight.current = false;
      setBusy(null);
    }
  };

  const create = () =>
    perform("create", async () => {
      const name = newKeyName.trim();
      const key = await onCreateKey(name || undefined);
      if (!key) {
        throw new Error("No API key returned");
      }
      setNewKeyName("");
      setRevealedKeys((current) =>
        nextRevealedKeys(current, { kind: "created", key })
      );
      return t("keyCreated");
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
      return result.hasMore ? t("revokingRemaining") : t("allRevoked");
    });
  const revoke = (item: ApiKeyListItem) =>
    perform(item.id, async () => {
      revokedFocus.current = {
        id: item.id,
        index: keys?.findIndex((key) => key.id === item.id) ?? 0,
      };
      try {
        await onRevokeKey(item.id);
      } catch (error) {
        revokedFocus.current = null;
        throw error;
      }
      setRevealedKeys((current) =>
        nextRevealedKeys(current, { kind: "revoked", keyId: item.id })
      );
      return t("keyRevoked");
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
      return t("keyRegenerated");
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
      setFeedback({ message: t("keyCopied"), error: false });
    } catch {
      setFeedback({
        message: t("copyFailed"),
        error: true,
      });
    }
  };

  return (
    <SettingsSection
      action={
        <Button
          className="shrink-0"
          disabled={isLoading || busy !== null}
          onClick={() => void create()}
          ref={createButtonRef}
          size="sm"
        >
          {busy === "create" ? <Spinner /> : null}
          {t("createKey")}
        </Button>
      }
      description={tIntegrations.rich("apiDescription", {
        link: (chunks) => (
          <a
            className="font-medium text-primary hover:underline"
            href={API_DOCS_URL}
            rel="noopener"
            target="_blank"
          >
            {chunks}
          </a>
        ),
      })}
      flush
      icon={<SettingsTile icon={KeyRound} tone="amber" />}
      id="api-keys"
      title={tIntegrations("apiTitle")}
    >
      <div className="divide-y" ref={listRef}>
        <div className="flex flex-col gap-1.5 px-4 py-3">
          <Label className="font-normal text-xs" htmlFor="api-key-name">
            {t("nameLabel")}
          </Label>
          <Input
            className="h-8 sm:max-w-xs"
            disabled={isLoading || busy !== null}
            id="api-key-name"
            maxLength={API_KEY_NAME_MAX_LENGTH}
            onChange={(event) => setNewKeyName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void create();
              }
            }}
            placeholder={t("namePlaceholder")}
            value={newKeyName}
          />
        </div>
        {feedback ? (
          <p
            className={
              feedback.error
                ? "px-4 py-2.5 text-destructive text-xs leading-5"
                : "px-4 py-2.5 text-muted-foreground text-xs leading-5"
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
          <SettingsListSkeleton label={t("loading")} rows={2} />
        ) : null}
        {!isLoading && keys?.length === 0 ? (
          <SettingsEmptyState>{t("empty")}</SettingsEmptyState>
        ) : null}
        {keys?.length ? (
          <SettingsList label={t("listLabel")}>
            {keys.map((item) => (
              <ApiKeyRow
                busy={busy === item.id}
                disabled={busy !== null}
                item={item}
                key={item.id}
                onRevoke={() => {
                  confirm({ kind: "revoke", item });
                }}
                onRotate={() => {
                  confirm({ kind: "rotate", item });
                }}
              />
            ))}
          </SettingsList>
        ) : null}
        {onRevokeAllKeys && keys?.length ? (
          <div className="flex justify-end px-2 py-1.5">
            <Button
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy !== null}
              onClick={() => {
                confirm({ kind: "revokeAll" });
              }}
              size="sm"
              variant="ghost"
            >
              {busy === "all" ? <Spinner /> : null}
              {t("revokeAll")}
            </Button>
          </div>
        ) : null}
        {pendingConfirm ? (
          <ConfirmDialog
            {...apiKeyConfirmCopy(pendingConfirm, t)}
            onConfirm={runConfirmed}
            onOpenChange={setConfirmOpen}
            open={confirmOpen}
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}
