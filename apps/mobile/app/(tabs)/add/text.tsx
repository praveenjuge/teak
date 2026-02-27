import {
  Host,
  List,
  Text,
  TextField,
  type TextFieldRef,
} from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  listStyle,
  scrollDisabled,
} from "@expo/ui/swift-ui/modifiers";
import { resolveTextCardInput } from "@teak/convex/shared";
import { router, Stack } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, PlatformColor, Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";
import {
  triggerSuccessHaptic,
  triggerValidationErrorHaptic,
} from "@/lib/haptics";
import { useCreateCard } from "@/lib/hooks/useCardOperations";

export default function AddTextScreen() {
  const [content, setContent] = useState("");
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );
  const textFieldRef = useRef<TextFieldRef>(null);
  const createCard = useCreateCard();
  const canSave = content.trim().length > 0 && !isSavingCard;

  const handleSaveText = useCallback(async () => {
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      setValidationMessage("Enter a bookmark, URL, or note before saving.");
      void triggerValidationErrorHaptic();
      Alert.alert("Error", "Please enter some content");
      return;
    }

    if (isSavingCard) {
      return;
    }

    setValidationMessage(null);
    setIsSavingCard(true);

    try {
      const resolved = resolveTextCardInput({ content: trimmedContent });
      await createCard({
        content: resolved.content,
        type: resolved.type === "link" ? resolved.type : undefined,
        url: resolved.url,
      });

      void triggerSuccessHaptic();
      textFieldRef.current?.setText("");
      router.back();
    } catch (error) {
      console.error(
        "Failed to save card:",
        error instanceof Error ? error.message : error
      );
      const message = "Failed to save card. Please try again.";
      setValidationMessage(message);
      Alert.alert("Error", message);
    } finally {
      setIsSavingCard(false);
    }
  }, [content, createCard, isSavingCard]);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityHint="Saves this text card."
              accessibilityLabel={isSavingCard ? "Saving card" : "Save card"}
              accessibilityRole="button"
              disabled={!canSave}
              hitSlop={8}
              onPress={() => void handleSaveText()}
            >
              <IconSymbol
                animationSpec={
                  canSave
                    ? {
                        effect: {
                          type: "bounce",
                          direction: "up",
                        },
                      }
                    : undefined
                }
                color={PlatformColor(canSave ? "label" : "tertiaryLabel")}
                name={isSavingCard ? "hourglass" : "checkmark"}
                weight={isSavingCard ? "regular" : "semibold"}
              />
            </Pressable>
          ),
        }}
      />
      <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={[listStyle("plain"), scrollDisabled()]}>
          <TextField
            allowNewlines
            defaultValue={content}
            multiline
            numberOfLines={16}
            onChangeText={setContent}
            placeholder="Enter your bookmark, URL, or note"
            ref={textFieldRef}
          />
          {validationMessage ? (
            <Text
              modifiers={[foregroundStyle("red"), font({ design: "rounded" })]}
            >
              {validationMessage}
            </Text>
          ) : null}
        </List>
      </Host>
    </>
  );
}
