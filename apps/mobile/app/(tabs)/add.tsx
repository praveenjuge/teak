import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useState, useRef } from "react";
import { useCreateCard } from "../../lib/hooks";
import type { Card } from "../../lib/api";
import { colors, borderWidths } from "../../constants/colors";
import { IconSymbol } from "../../components/ui/IconSymbol";

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function detectCardType(content: string): {
  type: Card["type"];
  data: Record<string, any>;
} {
  const trimmedContent = content.trim();

  if (isUrl(trimmedContent)) {
    try {
      const url = new URL(trimmedContent);
      return {
        type: "url",
        data: {
          url: trimmedContent,
          title: url.hostname,
          description: `Saved from ${url.hostname}`,
        },
      };
    } catch {
      // Fallback if URL parsing fails
      return {
        type: "url",
        data: {
          url: trimmedContent,
          title: trimmedContent,
        },
      };
    }
  }

  return {
    type: "text",
    data: {
      content: trimmedContent,
      title:
        trimmedContent.slice(0, 50) + (trimmedContent.length > 50 ? "..." : ""),
    },
  };
}

export default function AddScreen() {
  const [content, setContent] = useState("");
  const textInputRef = useRef<TextInput>(null);
  const createCardMutation = useCreateCard();

  const handleSave = () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      Alert.alert("Error", "Please enter some content");
      return;
    }

    const { type, data } = detectCardType(trimmedContent);

    createCardMutation.mutate(
      {
        type,
        data,
        metaInfo: {
          source: "Mobile App",
          tags: [],
        },
      },
      {
        onSuccess: () => {
          setContent("");
          textInputRef.current?.focus();
          Alert.alert("Success", "Card saved successfully!");
        },
        onError: (error) => {
          console.error("Failed to save card:", error);
          Alert.alert("Error", "Failed to save card. Please try again.");
        },
      }
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          ref={textInputRef}
          style={{
            borderBottomWidth: borderWidths.hairline,
            borderColor: colors.border,
            padding: 16,
            backgroundColor: colors.background,
            minHeight: 150,
            textAlignVertical: "top",
            color: colors.label,
          }}
          placeholder="Enter your bookmark, URL, or note"
          value={content}
          onChangeText={setContent}
          multiline
          autoCapitalize="sentences"
          autoCorrect={true}
          editable={!createCardMutation.isPending}
        />

        <View style={{ flexDirection: "row", margin: 16, gap: 8 }}>
          <TouchableOpacity
            style={{
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: colors.background,
              borderWidth: borderWidths.hairline,
              borderColor: colors.border,
              width: 50,
              height: 50,
            }}
            onPress={() => {
              // TODO: Implement file/image upload functionality
              console.log("File/Image upload pressed");
              Alert.alert(
                "File Upload",
                "File/Image upload functionality will be implemented here"
              );
            }}
          >
            <IconSymbol
              name="paperclip"
              size={20}
              color={colors.secondaryLabel}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: colors.background,
              borderWidth: borderWidths.hairline,
              borderColor: colors.border,
              width: 50,
              height: 50,
            }}
            onPress={() => {
              // TODO: Implement audio recording functionality
              console.log("Audio recording pressed");
              Alert.alert(
                "Audio Recording",
                "Audio recording functionality will be implemented here"
              );
            }}
          >
            <IconSymbol
              name="mic.fill"
              size={20}
              color={colors.secondaryLabel}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              borderRadius: 12,
              height: 50,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.primary,
              opacity:
                createCardMutation.isPending || !content.trim() ? 0.3 : 1,
            }}
            onPress={handleSave}
            disabled={createCardMutation.isPending || !content.trim()}
          >
            <Text style={{ fontWeight: "600", color: colors.adaptiveWhite }}>
              {createCardMutation.isPending ? "Saving..." : "Save Card"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content type indicator */}
        {content.trim() && (
          <View
            style={{
              backgroundColor: colors.background,
              padding: 12,
              borderRadius: 8,
              marginHorizontal: 20,
              borderLeftWidth: 4,
              borderLeftColor: isUrl(content.trim())
                ? colors.systemGreen
                : colors.primary,
            }}
          >
            <Text
              style={{
                color: colors.label,
                fontWeight: "500",
              }}
            >
              {isUrl(content.trim()) ? "🔗 URL Detected" : "📝 Text Note"}
            </Text>
            {isUrl(content.trim()) && (
              <Text
                style={{
                  color: colors.secondaryLabel,
                  marginTop: 4,
                }}
              >
                This will be saved as a bookmark
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
