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
            borderBottomWidth: 1,
            borderColor: "#d1d5db",
            padding: 16,
            backgroundColor: "#fff",
            minHeight: 120,
            textAlignVertical: "top",
          }}
          placeholder="Enter your bookmark, URL, or note"
          value={content}
          onChangeText={setContent}
          multiline
          autoCapitalize="sentences"
          autoCorrect={true}
          editable={!createCardMutation.isPending}
        />

        <View style={{ flexDirection: "row", margin: 20 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              alignItems: "center",
              padding: 14,
              borderRadius: 12,
              backgroundColor:
                createCardMutation.isPending || !content.trim()
                  ? "#9ca3af"
                  : "#2563eb",
            }}
            onPress={handleSave}
            disabled={createCardMutation.isPending || !content.trim()}
          >
            <Text style={{ fontWeight: "600", color: "#fff" }}>
              {createCardMutation.isPending ? "Saving..." : "Save Card"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content type indicator */}
        {content.trim() && (
          <View
            style={{
              backgroundColor: "#f3f4f6",
              padding: 12,
              borderRadius: 8,
              marginHorizontal: 20,
              borderLeftWidth: 4,
              borderLeftColor: isUrl(content.trim()) ? "#10b981" : "#6b7280",
            }}
          >
            <Text
              style={{
                color: "#374151",
                fontWeight: "500",
              }}
            >
              {isUrl(content.trim()) ? "🔗 URL Detected" : "📝 Text Note"}
            </Text>
            {isUrl(content.trim()) && (
              <Text
                style={{
                  fontSize: 12,
                  color: "#6b7280",
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
