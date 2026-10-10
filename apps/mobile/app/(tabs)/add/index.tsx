import { Host, List, Section } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
import { AddActionRow } from "@/components/add/AddActionRow";
import { UploadFileActionsSection } from "@/components/add/upload-file-actions-section";

const addActions = [
  {
    color: "systemBlue",
    href: "/(tabs)/add/text",
    icon: "doc.text.fill",
    label: "Note or Link",
  },
  {
    color: "systemOrange",
    href: "/(tabs)/add/record",
    icon: "mic.fill",
    label: "Voice Memo",
  },
] as const;

export default function AddScreen() {
  const router = useRouter();

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <List>
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Write"
        >
          {addActions.map((action) => (
            <AddActionRow
              color={action.color}
              key={action.href}
              label={action.label}
              onPress={() => router.push(action.href as never)}
              systemImage={action.icon}
            />
          ))}
        </Section>
        <Section
          modifiers={[font({ design: "rounded", weight: "medium" })]}
          title="Upload"
        >
          <UploadFileActionsSection />
        </Section>
      </List>
    </Host>
  );
}
