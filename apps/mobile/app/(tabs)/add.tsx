import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { useState } from "react";

export default function AddScreen() {
  const [title, setTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert("Error", "Please enter a title");
      return;
    }
    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      Alert.alert("Success", "Item added successfully!", [
        {
          text: "OK",
          onPress: () => setTitle(""),
        },
      ]);
    } catch (error) {
      Alert.alert("Error", "Failed to add item");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, flex: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          style={{
            borderWidth: 1,
            marginBottom: 20,
            borderColor: "#d1d5db",
            borderRadius: 8,
            padding: 12,
            backgroundColor: "#fff",
            color: "#111827",
          }}
          placeholder="Enter title"
          value={title}
          onChangeText={setTitle}
          autoCapitalize="sentences"
          autoCorrect={true}
        />
        <View style={{ flexDirection: "row", marginBottom: 24 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              borderRadius: 12,
              backgroundColor:
                isLoading || !title.trim() ? "#9ca3af" : "#2563eb",
            }}
            onPress={handleSave}
            disabled={isLoading || !title.trim()}
          >
            <Text style={{ fontWeight: "600", color: "#fff" }}>
              {isLoading ? "Saving..." : "Save Item"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
