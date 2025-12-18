import {
  Section,
  Host,
  HStack,
  Image,
  List,
  Spacer,
  Text,
  Button,
  VStack,
} from "@expo/ui/swift-ui";
import * as React from "react";
import { Alert } from "react-native";
import { colors } from "../../../constants/colors";
import { authClient } from "@/lib/auth-client";
import { useThemePreference } from "@/lib/theme-preference";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "@teak/convex";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const { preference, setPreference, isLoaded } = useThemePreference();
  const router = useRouter();
  const deleteAccount = useMutation(api.auth.deleteAccount);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const signOut = async () => {
    try {
      await authClient.signOut();
      router.replace("/(auth)");
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteAccount = async (confirmation: string) => {
    if (isDeleting) return;

    setDeleteError(null);

    if (confirmation.trim().toLowerCase() !== "delete account") {
      setDeleteError('Type "delete account" to confirm.');
      return;
    }

    setIsDeleting(true);

    try {
      await deleteAccount({});

      let deleteUserFailed = false;
      await authClient.deleteUser(undefined, {
        onSuccess: () => {
          router.replace("/(auth)");
        },
        onError: (ctx) => {
          setDeleteError(ctx.error?.message ?? "Failed to delete account.");
          deleteUserFailed = true;
        },
      });

      if (deleteUserFailed) return;
    } catch (error) {
      console.error(error);
      setDeleteError("Something went wrong while deleting your account.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAlert = () => {
    Alert.alert(
      "Delete Account",
      "This will permanently remove your account, cards, tags, and uploaded files. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            Alert.prompt(
              "Delete Account",
              'Type "delete account" to confirm.',
              [
                {
                  text: "Cancel",
                  style: "cancel",
                },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: (confirmation: string | undefined) => {
                    void handleDeleteAccount(confirmation ?? "");
                  },
                },
              ],
              "plain-text"
            );
          },
        },
      ]
    );
  };

  const appearanceOptions: {
    value: Parameters<typeof setPreference>[0];
    title: string;
  }[] = [
    {
      value: "system",
      title: "Match Device",
    },
    {
      value: "light",
      title: "Light",
    },
    {
      value: "dark",
      title: "Dark",
    },
  ];

  if (!isLoaded) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Settings",
        }}
      />
      <Host matchContents useViewportSizeMeasurement style={{ flex: 1 }}>
        <List scrollEnabled>
          <Section title="Appearance">
            {appearanceOptions.map((option) => {
              const isSelected = preference === option.value;

              return (
                <HStack
                  key={option.value}
                  onPress={() => setPreference(option.value)}
                >
                  <Text>{option.title}</Text>
                  <Spacer />
                  {isSelected && (
                    <Image
                      systemName="checkmark"
                      color={
                        isSelected ? colors.primary : (colors.border as any)
                      }
                      size={18}
                    />
                  )}
                </HStack>
              );
            })}
          </Section>
          <Section title="Profile">
            <HStack>
              <Text color="primary">Email</Text>
              <Spacer />
              <Text color="secondary" lineLimit={1}>
                {session?.user?.email ?? "Not logged in"}
              </Text>
            </HStack>
            <Button
              onPress={() => {
                void signOut();
              }}
              role="destructive"
            >
              <HStack spacing={8}>
                <Text color="primary">Log Out</Text>
                <Spacer />
                <Image systemName="chevron.right" size={14} color="secondary" />
              </HStack>
            </Button>
          </Section>
          <Section title="Advanced">
            <Button
              role="destructive"
              onPress={handleDeleteAlert}
              disabled={isDeleting}
            >
              <HStack spacing={8}>
                <Text color="primary">
                  {`${isDeleting ? "Deleting..." : "Delete Account"}${deleteError ? ` - ${deleteError}` : ""}`}
                </Text>
                <Spacer />
                <Image systemName="chevron.right" size={14} color="secondary" />
              </HStack>
            </Button>
          </Section>
        </List>
      </Host>
    </>
  );
}
