import {
  Host,
  Text,
  TextField,
  type TextFieldRef,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import {
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  onTapGesture,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { router, Stack } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, PlatformColor, Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { createCardFromText } from "@/lib/createCardFromText";
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
  const textFieldState = useNativeState("");
  const textFieldRef = useRef<TextFieldRef>(null);
  const createCard = useCreateCard();
  const canSave = content.trim().length > 0 && !isSavingCard;

  const handleSaveText = useCallback(async () => {
    if (!content.trim()) {
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
      await createCardFromText(content, {
        createCard,
      });

      void triggerSuccessHaptic();
      setContent("");
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

  const focusField = useCallback(() => {
    void textFieldRef.current?.focus();
  }, []);

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
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <VStack
          alignment="leading"
          modifiers={[
            padding({ horizontal: 20, vertical: 16 }),
            frame({
              alignment: "topLeading",
              maxHeight: 10_000,
              maxWidth: 10_000,
            }),
            contentShape(shapes.rectangle()),
            onTapGesture(focusField),
          ]}
          spacing={12}
        >
          {validationMessage ? (
            <Text
              modifiers={[
                foregroundStyle("red"),
                font({ design: "rounded", size: 14 }),
              ]}
            >
              {validationMessage}
            </Text>
          ) : null}
          <TextField
            autoFocus
            axis="vertical"
            modifiers={[
              font({ design: "rounded", size: 17 }),
              lineLimit({ min: 15, max: 500 }),
              frame({
                alignment: "topLeading",
                maxHeight: 10_000,
                maxWidth: 10_000,
              }),
            ]}
            onTextChange={setContent}
            placeholder="Enter your bookmark, URL, or note"
            ref={textFieldRef}
            text={textFieldState}
          />
        </VStack>
      </Host>
    </>
  );
}
