import {
  Button,
  ContentUnavailableView,
  Host,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, font } from "@expo/ui/swift-ui/modifiers";
import { useConvexAuth } from "convex/react";
import { useLinkingURL } from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { createCardFromText } from "@/lib/createCardFromText";
import {
  triggerSuccessHaptic,
  triggerValidationErrorHaptic,
} from "@/lib/haptics";
import { useCreateCard } from "@/lib/hooks/useCardOperations";
import { textFromSaveLink } from "@/lib/save-link";

type SaveStatus = "saving" | "saved" | "empty" | "signedOut" | "error";

const STATUS: Record<
  SaveStatus,
  { description: string; systemImage: string; title: string }
> = {
  saving: {
    description: "Saving to your Teak vault…",
    systemImage: "arrow.down.circle",
    title: "Saving",
  },
  saved: {
    description: "It's in your library.",
    systemImage: "checkmark.circle.fill",
    title: "Saved",
  },
  empty: {
    description: "The shortcut didn't send any text or link.",
    systemImage: "tray",
    title: "Nothing to Save",
  },
  signedOut: {
    description: "Open Teak and sign in, then run the shortcut again.",
    systemImage: "person.crop.circle.badge.exclamationmark",
    title: "Sign In Required",
  },
  error: {
    description: "Check your connection and try again.",
    systemImage: "xmark.circle",
    title: "Save Failed",
  },
};

const SAVED_DISMISS_MS = 1200;

/**
 * Opened by the "Save to Teak" Shortcuts action as teak://save?text=…, so
 * any shortcut can save text or a link, like the share sheet.
 */
export default function SaveFromShortcutScreen() {
  const text = textFromSaveLink(useLinkingURL());
  const { isAuthenticated, isLoading } = useConvexAuth();
  const createCard = useCreateCard();
  const [status, setStatus] = useState<SaveStatus>("saving");
  const started = useRef(false);

  useEffect(() => {
    if (isLoading || started.current) {
      return;
    }
    started.current = true;
    if (!text) {
      setStatus("empty");
      return;
    }
    if (!isAuthenticated) {
      setStatus("signedOut");
      return;
    }
    createCardFromText(text, { createCard, source: "share_intent" })
      .then(() => {
        setStatus("saved");
        void triggerSuccessHaptic();
        setTimeout(() => router.dismissTo("/(tabs)/(home)"), SAVED_DISMISS_MS);
      })
      .catch(() => {
        setStatus("error");
        void triggerValidationErrorHaptic();
      });
  }, [createCard, isAuthenticated, isLoading, text]);

  const config = STATUS[status];
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack alignment="center" spacing={20}>
        <Spacer />
        <ContentUnavailableView
          description={config.description}
          systemImage={config.systemImage as never}
          title={config.title}
        />
        {status === "saving" || status === "saved" ? null : (
          <Button
            modifiers={[buttonStyle("glass"), controlSize("large")]}
            onPress={() => router.dismissTo("/")}
          >
            <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
              Close
            </Text>
          </Button>
        )}
        <Spacer />
      </VStack>
    </Host>
  );
}
