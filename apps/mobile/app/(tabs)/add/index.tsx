import {
  Button,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
} from "@expo/ui/swift-ui";
import { font, frame, tint } from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
import { PlatformColor } from "react-native";
import { UploadFileActionsSection } from "@/components/add/upload-file-actions-section";

const addActions = [
  {
    href: "/(tabs)/add/text",
    icon: "textformat",
    label: "Text or URL",
  },
  {
    href: "/(tabs)/add/record",
    icon: "mic.fill",
    label: "Record Audio",
  },
] as const;

export default function AddScreen() {
  const router = useRouter();

  return (
    <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
      <List>
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Add Content"
        >
          {addActions.map((action) => (
            <Button
              key={action.href}
              modifiers={[tint(PlatformColor("label"))]}
              onPress={() => router.push(action.href as never)}
            >
              <HStack spacing={12}>
                <Image
                  modifiers={[frame({ height: 18, width: 18 })]}
                  size={14}
                  systemName={action.icon}
                />
                <Text modifiers={[font({ design: "rounded" })]}>
                  {action.label}
                </Text>
                <Spacer />
                <Image color="secondary" size={14} systemName="chevron.right" />
              </HStack>
            </Button>
          ))}
        </Section>
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Upload Files"
        >
          <UploadFileActionsSection />
        </Section>
      </List>
    </Host>
  );
}
