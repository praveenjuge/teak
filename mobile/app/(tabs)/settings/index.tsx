import {
  Section,
  Host,
  HStack,
  Image,
  List,
  Spacer,
  Text,
  Button,
} from "@expo/ui/swift-ui";
import { Alert } from "react-native";
import { colors } from "../../../constants/colors";
import { authClient } from "@/lib/auth-client";
import { useThemePreference } from "@/lib/theme-preference";
import { Stack, useRouter } from "expo-router";
import { ScrollView } from "react-native";

export default function SettingsScreen() {
  const { data: session } = authClient.useSession();
  const { preference, setPreference, isLoaded } = useThemePreference();
  const router = useRouter();

  const handleSignOut = async () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const signOut = async () => {
    try {
      await authClient.signOut();
      router.replace("/(auth)");
    } catch (error) {
      console.error(error);
    }
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
      <ScrollView>
        <Host matchContents useViewportSizeMeasurement>
          <List scrollEnabled={false}>
            <Section title="Profile">
              <HStack>
                <Text color="primary">Email</Text>
                <Spacer />
                <Text color="secondary">
                  {session?.user?.email ?? "Not logged in"}
                </Text>
              </HStack>
              <Button
                onPress={() => {
                  void handleSignOut();
                }}
                role="destructive"
              >
                <HStack spacing={8}>
                  <Text color="primary">Log Out</Text>
                  <Spacer />
                  <Image
                    systemName="chevron.right"
                    size={14}
                    color="secondary"
                  />
                </HStack>
              </Button>
            </Section>
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
                    <Image
                      systemName={
                        isSelected ? "checkmark.circle.fill" : "circle"
                      }
                      color={
                        isSelected ? colors.primary : (colors.border as any)
                      }
                      size={18}
                    />
                  </HStack>
                );
              })}
            </Section>
          </List>
        </Host>
      </ScrollView>
    </>
  );
}
