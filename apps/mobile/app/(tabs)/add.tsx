import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";

export default function AddScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
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
          onPress: () => {
            setTitle("");
            setDescription("");
            setCategory("");
          },
        },
      ]);
    } catch (error) {
      Alert.alert("Error", "Failed to add item");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    Alert.alert("Clear Form", "Are you sure you want to clear all fields?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          setTitle("");
          setDescription("");
          setCategory("");
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter item title"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
              autoCapitalize="sentences"
              autoCorrect={true}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Category</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter category (optional)"
              value={category}
              onChangeText={setCategory}
              maxLength={50}
              autoCapitalize="words"
              autoCorrect={true}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Enter description (optional)"
              value={description}
              onChangeText={setDescription}
              multiline={true}
              numberOfLines={4}
              maxLength={500}
              textAlignVertical="top"
              autoCapitalize="sentences"
              autoCorrect={true}
            />
          </View>

          <View style={styles.characterCount}>
            <Text style={styles.characterCountText}>
              {description.length}/500 characters
            </Text>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.clearButton]}
            onPress={handleClear}
            disabled={isLoading}
          >
            <Ionicons name="trash-outline" size={20} color="#dc2626" />
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              styles.saveButton,
              isLoading && styles.disabledButton,
            ]}
            onPress={handleSave}
            disabled={isLoading || !title.trim()}
          >
            {isLoading ? (
              <Text style={styles.saveButtonText}>Saving...</Text>
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color="#ffffff" />
                <Text style={styles.saveButtonText}>Save Item</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.tips}>
          <Text style={styles.tipsTitle}>💡 Tips</Text>
          <Text style={styles.tipText}>
            • Use descriptive titles for better organization
          </Text>
          <Text style={styles.tipText}>
            • Categories help you group similar items
          </Text>
          <Text style={styles.tipText}>
            • Add detailed descriptions for future reference
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  form: {
    backgroundColor: "#ffffff",
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#ffffff",
    color: "#111827",
  },
  textArea: {
    height: 100,
    paddingTop: 12,
  },
  characterCount: {
    alignItems: "flex-end",
    marginTop: -10,
  },
  characterCountText: {
    fontSize: 12,
    color: "#6b7280",
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  clearButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dc2626",
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#dc2626",
  },
  saveButton: {
    backgroundColor: "#2563eb",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  disabledButton: {
    backgroundColor: "#9ca3af",
  },
  tips: {
    backgroundColor: "#ffffff",
    padding: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
  },
  tipText: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 8,
    lineHeight: 20,
  },
});
