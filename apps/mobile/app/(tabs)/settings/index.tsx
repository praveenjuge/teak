import {
  Button,
  Host,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  Text,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { authClient } from "@/lib/auth-client";
import { useThemePreference } from "@/lib/theme-preference";
import { colors } from "../../../constants/colors";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const { preference, setPreference, isLoaded } = useThemePreference();
  const router = useRouter();
  const currentUser = useQuery(api.auth.getCurrentUser, {});
  const deleteAccount = useMutation(api.auth.deleteAccount);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const signOut = async () => {
    try {
      await authClient.signOut();
      router.replace("/(auth)/welcome");
    } catch (error) {
      console.error(
        "Sign out error:",
        error instanceof Error ? error.message : error
      );
    }
  };

  const handleLogoutAlert = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log Out", style: "destructive", onPress: signOut },
    ]);
  };

  const handleDeleteAccount = async (confirmation: string) => {
    if (isDeleting) {
      return;
    }

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
          router.replace("/(auth)/welcome");
        },
        onError: (ctx) => {
          setDeleteError(ctx.error?.message ?? "Failed to delete account.");
          deleteUserFailed = true;
        },
      });

      if (deleteUserFailed) {
        return;
      }
    } catch (error) {
      console.error(
        "Delete account error:",
        error instanceof Error ? error.message : error
      );
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
          text: "DELETE ACCOUNT",
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
                    handleDeleteAccount(confirmation ?? "").catch(
                      console.error
                    );
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

  if (!isLoaded) {
    return null;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Settings",
        }}
      />
      <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
        <List>
          <Section title="Appearance">
            {appearanceOptions.map((option) => {
              const isSelected = preference === option.value;

              return (
                <Button
                  key={option.value}
                  modifiers={[buttonStyle("plain")]}
                  onPress={() => setPreference(option.value)}
                >
                  <HStack>
                    <Text modifiers={[font({ design: "rounded" })]}>
                      {option.title}
                    </Text>
                    <Spacer />
                    {isSelected && (
                      <Image
                        color={
                          isSelected ? colors.primary : (colors.border as any)
                        }
                        size={18}
                        systemName="checkmark"
                      />
                    )}
                  </HStack>
                </Button>
              );
            })}
          </Section>
          <Section title="Profile">
            <HStack>
              <Text modifiers={[font({ design: "rounded" })]}>Email</Text>
              <Spacer />
              <Text
                modifiers={[
                  foregroundStyle({ type: "hierarchical", style: "secondary" }),
                  font({ design: "rounded" }),
                  lineLimit(1),
                ]}
              >
                {session?.user?.email ?? "Not logged in"}
              </Text>
            </HStack>
            <HStack>
              <Text modifiers={[font({ design: "rounded" })]}>Usage</Text>
              <Spacer />
              {currentUser === undefined ? (
                <ProgressView />
              ) : (
                <Text
                  modifiers={[
                    foregroundStyle({
                      type: "hierarchical",
                      style: "secondary",
                    }),
                    font({ design: "rounded" }),
                  ]}
                >
                  {currentUser
                    ? `${currentUser.cardCount} Cards`
                    : "Not available"}
                </Text>
              )}
            </HStack>
            <Button
              modifiers={[disabled(isDeleting)]}
              onPress={handleDeleteAlert}
            >
              <HStack spacing={8}>
                <Text
                  modifiers={[
                    foregroundStyle({ type: "hierarchical", style: "primary" }),
                    font({ design: "rounded" }),
                  ]}
                >
                  {`${isDeleting ? "Deleting..." : "Delete Account"}${deleteError ? ` - ${deleteError}` : ""}`}
                </Text>
                <Spacer />
                <Image color="secondary" size={14} systemName="chevron.right" />
              </HStack>
            </Button>
            <Button onPress={handleLogoutAlert}>
              <HStack spacing={8}>
                <Text
                  modifiers={[
                    foregroundStyle({ type: "hierarchical", style: "primary" }),
                    font({ design: "rounded" }),
                  ]}
                >
                  Log Out
                </Text>
                <Spacer />
                <Image color="secondary" size={14} systemName="chevron.right" />
              </HStack>
            </Button>
          </Section>
          <Section title="About">
            <HStack>
              <Text modifiers={[font({ design: "rounded" })]}>Teak</Text>
              <Spacer />
              <Text
                modifiers={[
                  foregroundStyle({ type: "hierarchical", style: "secondary" }),
                  font({ design: "rounded" }),
                ]}
              >
                by @praveenjuge
              </Text>
            </HStack>
            <HStack>
              <Text
                modifiers={[
                  foregroundStyle({ type: "hierarchical", style: "secondary" }),
                  font({ design: "rounded" }),
                ]}
              >
                Hope you enjoy using Teak as much as I enjoyed creating it.
              </Text>
              <Spacer />
            </HStack>
          </Section>
        </List>
      </Host>
    </>
  );
}
