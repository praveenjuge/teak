import { Host, Image, ShareLink } from "@expo/ui/swift-ui";
import { api } from "@teak/convex";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useMutation } from "convex/react";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, PlatformColor } from "react-native";
import {
  copyTextToClipboard,
  isUserShareCancel,
  shareSheetFile,
} from "@/lib/card-actions";
import {
  type CardSheetDetail,
  getSheetCopyText,
  getSheetShareTarget,
} from "@/lib/card-sheet";
import {
  triggerSuccessHaptic,
  triggerValidationErrorHaptic,
} from "@/lib/haptics";

const DESTRUCTIVE_TINT = PlatformColor("systemRed");

/**
 * The card's actions in the sheet's floating Liquid Glass toolbar, like the
 * Photos viewer: share on the leading edge, everyday actions in the middle,
 * and delete on the trailing edge behind a confirming menu.
 */
function CardActionsToolbar({
  card,
  onError,
}: {
  card: CardSheetDetail;
  /** Shows a failed action inline in the sheet; null clears it. */
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const updateCardField = useMutation(api.cards.updateCardField);
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(
    null
  );

  const isFavorited = favoriteOverride ?? card.isFavorited ?? false;

  useEffect(() => {
    if (favoriteOverride !== null && card.isFavorited === favoriteOverride) {
      setFavoriteOverride(null);
    }
  }, [card.isFavorited, favoriteOverride]);

  const copyText = getSheetCopyText(card);
  const shareTarget = getSheetShareTarget(card);
  const linkUrl = card.type === "link" ? (card.url?.trim() ?? "") : "";

  const showError = useCallback(
    (message: string) => {
      onError(message);
      void triggerValidationErrorHaptic();
    },
    [onError]
  );

  const handleToggleFavorite = useCallback(async () => {
    const next = !isFavorited;
    setFavoriteOverride(next);
    try {
      await updateCardField({
        cardId: card._id,
        field: "isFavorited",
        value: next,
      });
      void triggerSuccessHaptic();
    } catch {
      setFavoriteOverride(!next);
      showError("Couldn't update this favorite.");
    }
  }, [card._id, isFavorited, showError, updateCardField]);

  const handleOpenLink = useCallback(async () => {
    const safeUrl = sanitizeExternalUrl(linkUrl);
    if (!safeUrl) {
      showError("This link looks unsafe to open.");
      return;
    }
    try {
      const supported = await Linking.canOpenURL(safeUrl);
      if (!supported) {
        showError("No app can open this link.");
        return;
      }
      await Linking.openURL(safeUrl);
    } catch {
      showError("Couldn't open this link.");
    }
  }, [linkUrl, showError]);

  const handleCopy = useCallback(async () => {
    if (!copyText) {
      return;
    }
    try {
      await copyTextToClipboard(copyText);
      void triggerSuccessHaptic();
    } catch {
      showError("Couldn't copy to the clipboard.");
    }
  }, [copyText, showError]);

  // Files go through the system share sheet; text and links use SwiftUI's
  // ShareLink below, which presents correctly from inside this sheet.
  const handleShareFile = useCallback(async () => {
    if (shareTarget.kind !== "file") {
      return;
    }
    try {
      await shareSheetFile(shareTarget.url, shareTarget.fileName);
    } catch (shareError) {
      if (isUserShareCancel(shareError)) {
        return;
      }
      showError("Couldn't share this file.");
    }
  }, [shareTarget, showError]);

  const handleDelete = useCallback(async () => {
    try {
      await updateCardField({ cardId: card._id, field: "delete" });
      void triggerSuccessHaptic();
      router.back();
    } catch {
      showError("Couldn't delete this card.");
    }
  }, [card._id, router, showError, updateCardField]);

  // Each tap starts fresh, so an earlier failure doesn't linger.
  const run = (action: () => Promise<void>) => () => {
    onError(null);
    void action();
  };

  return (
    <Stack.Toolbar>
      {shareTarget.kind === "item" ? (
        <Stack.Toolbar.View>
          <Host matchContents>
            <ShareLink item={shareTarget.item} subject={shareTarget.subject}>
              <Image
                color={PlatformColor("label") as any}
                size={20}
                systemName="square.and.arrow.up"
              />
            </ShareLink>
          </Host>
        </Stack.Toolbar.View>
      ) : (
        <Stack.Toolbar.Button
          accessibilityLabel="Share"
          disabled={shareTarget.kind === "none"}
          icon="square.and.arrow.up"
          onPress={run(handleShareFile)}
        />
      )}
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button
        accessibilityLabel={isFavorited ? "Unfavorite" : "Favorite"}
        icon={isFavorited ? "heart.fill" : "heart"}
        onPress={run(handleToggleFavorite)}
        tintColor={isFavorited ? DESTRUCTIVE_TINT : undefined}
      />
      <Stack.Toolbar.Button
        accessibilityLabel="Copy"
        hidden={!copyText}
        icon="doc.on.doc"
        onPress={run(handleCopy)}
      />
      <Stack.Toolbar.Button
        accessibilityLabel="Open in Browser"
        hidden={!linkUrl}
        icon="safari"
        onPress={run(handleOpenLink)}
      />
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Menu
        accessibilityLabel="Delete"
        icon="trash"
        tintColor={DESTRUCTIVE_TINT}
        title="This card will be moved to trash."
      >
        <Stack.Toolbar.MenuAction
          destructive
          icon="trash"
          onPress={run(handleDelete)}
        >
          Delete Card
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

export { CardActionsToolbar };
