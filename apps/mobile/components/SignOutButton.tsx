import { colors } from "@/constants/colors";
import { useClerk } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { Text, TouchableOpacity } from "react-native";

export const SignOutButton = () => {
  // Use `useClerk()` to access the `signOut()` function
  const { signOut } = useClerk();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await signOut();
      // Redirect to your desired page
      router.replace("/(auth)");
    } catch (err) {
      // See https://clerk.com/docs/custom-flows/error-handling
      // for more info on error handling
      console.error(JSON.stringify(err, null, 2));
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
