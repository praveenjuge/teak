import {
  Button,
  Form,
  Host,
  HStack,
  Image,
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
import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { authClient } from "@/lib/auth-client";
import { useThemePreference } from "@/lib/theme-preference";

const DELETE_CONFIRMATION_PHRASE = "delete account";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const { preference, setPreference, isLoaded } = useThemePreference();
  const router = useRouter();
  const currentUser = useQuery(api.auth.getCurrentUser, {});
  const deleteAccount = useMutation(api.auth.deleteAccount);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const appearanceOptions: {
    title: string;
    value: "system" | "light" | "dark";
  }[] = [
    {
      title: "Match Device",
      value: "system",
    },
    {
      title: "Light",
      value: "light",
    },
    {
      title: "Dark",
      value: "dark",
    },
  ];

  const usageLabel = useMemo(() => {
    if (currentUser === undefined) {
      return null;
    }

    if (!currentUser) {
      return "Not available";
    }

    return `${currentUser.cardCount} Cards`;
  }, [currentUser]);

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

    if (confirmation.trim().toLowerCase() !== DELETE_CONFIRMATION_PHRASE) {
      setDeleteError(`Type "${DELETE_CONFIRMATION_PHRASE}" to confirm.`);
      return;
    }

    setIsDeleting(true);

    try {
      await deleteAccount({});

      let deleteUserFailed = false;
      await authClient.deleteUser(undefined, {
        onError: (ctx) => {
          setDeleteError(ctx.error?.message ?? "Failed to delete account.");
          deleteUserFailed = true;
        },
        onSuccess: () => {
          router.replace("/(auth)/welcome");
        },
      });

      if (deleteUserFailed) {
        return;
      }
    } catch (error) {
      setDeleteError("Something went wrong while deleting your account.");
      console.error(
        "Delete account error:",
        error instanceof Error ? error.message : error
      );
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
              `Type "${DELETE_CONFIRMATION_PHRASE}" to confirm.`,
              [
                {
                  text: "Cancel",
                  style: "cancel",
                },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: (typedConfirmation: string | undefined) => {
                    handleDeleteAccount(typedConfirmation ?? "").catch(
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

  if (!isLoaded) {
    return null;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Settings",
          headerLargeTitle: true,
        }}
      />
      <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
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
                    {isSelected ? (
                      <Image color="primary" size={18} systemName="checkmark" />
                    ) : null}
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
              {usageLabel ? (
                <Text
                  modifiers={[
                    foregroundStyle({
                      type: "hierarchical",
                      style: "secondary",
                    }),
                    font({ design: "rounded" }),
                  ]}
                >
                  {usageLabel}
                </Text>
              ) : (
                <ProgressView />
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
            <Text
              modifiers={[
                foregroundStyle({ type: "hierarchical", style: "secondary" }),
                font({ design: "rounded" }),
              ]}
            >
              Hope you enjoy using Teak as much as I enjoyed creating it.
            </Text>
          </Section>
        </Form>
      </Host>
    </>
  );
}
