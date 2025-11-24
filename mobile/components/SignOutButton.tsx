import { colors } from "@/constants/colors";
import { useRouter } from "expo-router";
import { Text, TouchableOpacity } from "react-native";
import { authClient } from "@/lib/auth-client";

export const SignOutButton = () => {
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      router.replace("/(auth)");
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <TouchableOpacity
      style={{
        padding: 12,
        backgroundColor: colors.primary,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        minHeight: 48,
      }}
      onPress={() => {
        handleSignOut();
      }}
    >
      <Text style={{ color: "white", fontWeight: "bold" }}>Sign Out</Text>
    </TouchableOpacity>
  );
};
