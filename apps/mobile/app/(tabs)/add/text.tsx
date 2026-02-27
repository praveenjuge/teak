import {
  Button,
  Host,
  HStack,
  List,
  Spacer,
  Text,
  TextField,
  type TextFieldRef,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  listStyle,
  scrollDisabled,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { resolveTextCardInput } from "@teak/convex/shared";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { colors } from "@/constants/colors";
import { showSavingFeedback, showSuccessFeedback } from "@/lib/feedback-status";
import { useCreateCard } from "@/lib/hooks/useCardOperations";

export default function AddTextScreen() {
  const [content, setContent] = useState("");
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );
  const textFieldRef = useRef<TextFieldRef>(null);
  const createCard = useCreateCard();

  const handleSaveText = useCallback(async () => {
    const trimmedContent = content.trim();

    if (!trimmedContent) {
      setValidationMessage("Enter a bookmark, URL, or note before saving.");
      Alert.alert("Error", "Please enter some content");
      return;
    }

    if (isSavingCard) {
      return;
    }

    setValidationMessage(null);
    setIsSavingCard(true);
    showSavingFeedback();

    try {
      const resolved = resolveTextCardInput({ content: trimmedContent });
      await createCard({
        content: resolved.content,
        type: resolved.type === "link" ? resolved.type : undefined,
        url: resolved.url,
      });

      showSuccessFeedback();
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
            modifiers={[
              foregroundStyle("red"),
              font({ design: "rounded", size: 13 }),
            ]}
          >
            {validationMessage}
          </Text>
        ) : null}
        <Button
          modifiers={[
            disabled(isSavingCard),
            buttonStyle("borderedProminent"),
            controlSize("large"),
            tint(colors.primary),
          ]}
          onPress={handleSaveText}
        >
          <HStack alignment="center" spacing={10}>
            <Spacer />
            <Text
              modifiers={[
                foregroundStyle({
                  style: "primary",
                  type: "hierarchical",
                }),
                font({ design: "rounded" }),
              ]}
            >
              {isSavingCard ? "Saving..." : "Save"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </List>
    </Host>
  );
}
