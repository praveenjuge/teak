import {
  Button,
  ConfirmationDialog,
  Label,
  Section,
  ShareLink,
} from "@expo/ui/swift-ui";
import { api } from "@teak/convex";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking } from "react-native";
import { SheetText } from "@/components/card-sheet/SheetText";
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

function ActionsSection({ card }: { card: CardSheetDetail }) {
  const router = useRouter();
  const updateCardField = useMutation(api.cards.updateCardField);
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(
    null
  );
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFavorited = favoriteOverride ?? card.isFavorited ?? false;
  const copyText = getSheetCopyText(card);
  const shareTarget = getSheetShareTarget(card);
  const linkUrl = card.type === "link" ? (card.url?.trim() ?? "") : "";

  const showError = useCallback((message: string) => {
    setError(message);
    void triggerValidationErrorHaptic();
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleToggleFavorite = useCallback(async () => {
    clearError();
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
  }, [card._id, clearError, isFavorited, showError, updateCardField]);

  const handleOpenLink = useCallback(async () => {
    clearError();
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
  }, [clearError, linkUrl, showError]);

  const handleCopy = useCallback(async () => {
    if (!copyText) {
      return;
    }
    clearError();
    try {
      await copyTextToClipboard(copyText);
      void triggerSuccessHaptic();
    } catch {
      showError("Couldn't copy to the clipboard.");
    }
  }, [clearError, copyText, showError]);

  const handleShareFile = useCallback(async () => {
    if (shareTarget.kind !== "file") {
      return;
    }
    clearError();
    try {
      await shareSheetFile(shareTarget.url, shareTarget.fileName);
    } catch (shareError) {
      if (isUserShareCancel(shareError)) {
        return;
      }
      showError("Couldn't share this file.");
    }
  }, [clearError, shareTarget, showError]);

  const handleDelete = useCallback(async () => {
    setIsDeleteOpen(false);
    clearError();
    try {
      await updateCardField({ cardId: card._id, field: "delete" });
      void triggerSuccessHaptic();
      router.back();
    } catch {
      showError("Couldn't delete this card.");
    }
  }, [card._id, clearError, router, showError, updateCardField]);

  return (
    <Section title="Actions">
      <Button onPress={() => void handleToggleFavorite()}>
        <Label systemImage={isFavorited ? "star.fill" : "star"}>
          <SheetText>{isFavorited ? "Favorited" : "Favorite"}</SheetText>
        </Label>
      </Button>
      {linkUrl ? (
        <Button onPress={() => void handleOpenLink()}>
          <Label systemImage="arrow.up.forward">
            <SheetText>Open Link</SheetText>
          </Label>
        </Button>
      ) : null}
      {copyText ? (
        <Button onPress={() => void handleCopy()}>
          <Label systemImage="doc.on.doc">
            <SheetText>Copy</SheetText>
          </Label>
        </Button>
      ) : null}
      {shareTarget.kind === "item" ? (
        <ShareLink item={shareTarget.item} subject={shareTarget.subject}>
          <Label systemImage="square.and.arrow.up">
            <SheetText>Share</SheetText>
          </Label>
        </ShareLink>
      ) : null}
      {shareTarget.kind === "file" ? (
        <Button onPress={() => void handleShareFile()}>
          <Label systemImage="square.and.arrow.up">
            <SheetText>Share</SheetText>
          </Label>
        </Button>
      ) : null}
      <ConfirmationDialog
        isPresented={isDeleteOpen}
        onIsPresentedChange={setIsDeleteOpen}
        title="Delete this card?"
      >
        <ConfirmationDialog.Trigger>
          <Button onPress={() => setIsDeleteOpen(true)}>
            <Label systemImage="trash">
              <SheetText>Delete</SheetText>
            </Label>
          </Button>
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Actions>
          {/* biome-ignore lint/a11y/useValidAriaRole: expo-ui Button role maps to SwiftUI, not DOM ARIA */}
          <Button
            label="Delete Card"
            onPress={() => void handleDelete()}
            role="destructive"
            systemImage="trash"
          />
          {/* biome-ignore lint/a11y/useValidAriaRole: expo-ui Button role maps to SwiftUI, not DOM ARIA */}
          <Button
            label="Cancel"
            onPress={() => setIsDeleteOpen(false)}
            role="cancel"
          />
        </ConfirmationDialog.Actions>
        <ConfirmationDialog.Message>
          <SheetText>This card will be moved to trash.</SheetText>
        </ConfirmationDialog.Message>
      </ConfirmationDialog>
      {error ? <SheetText destructive>{error}</SheetText> : null}
    </Section>
  );
}

export { ActionsSection };
