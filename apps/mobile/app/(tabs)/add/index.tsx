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
import { foregroundStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
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
        <Section title="Add Content">
          {addActions.map((action) => (
            <Button
              key={action.href}
              onPress={() => router.push(action.href as never)}
            >
              <HStack spacing={12}>
                <Image
                  color="primary"
                  modifiers={[frame({ height: 18, width: 18 })]}
                  size={14}
                  systemName={action.icon}
                />
                <Text
                  modifiers={[
                    foregroundStyle({
                      style: "primary",
                      type: "hierarchical",
                    }),
                  ]}
                >
                  {action.label}
                </Text>
                <Spacer />
                <Image color="secondary" size={14} systemName="chevron.right" />
              </HStack>
            </Button>
          ))}
        </Section>
        <UploadFileActionsSection />
      </List>
    </Host>
  );
}
