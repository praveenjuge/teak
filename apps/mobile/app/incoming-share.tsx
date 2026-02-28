import {
  Button,
  ContentUnavailableView,
  Host,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  font,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { PlatformColor } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";
import type { IncomingShareStatus } from "@/lib/share/types";
import { useIncomingShareImport } from "@/lib/share/useIncomingShareImport";

interface StatusConfig {
  description: string;
  systemImage: SFSymbol;
  title: string;
}

const SAVING_STATUS_CONFIG: StatusConfig = {
  title: "Saving",
  description: "Saving to your Teak vault...",
  systemImage: "arrow.down.circle",
};

const STATUS_CONFIG_BY_STATUS: Record<IncomingShareStatus, StatusConfig> = {
  resolving: SAVING_STATUS_CONFIG,
  saving: SAVING_STATUS_CONFIG,
  saved: {
    title: "Saved",
    description: "Your shared content was saved.",
    systemImage: "checkmark.circle.fill",
  },
  partial: {
    title: "Partially Failed",
    description: "Some items could not be saved.",
    systemImage: "exclamationmark.triangle",
  },
  authRequired: {
    title: "Sign In Required",
    description: "Sign in to save shared content.",
    systemImage: "person.crop.circle.badge.exclamationmark",
  },
  error: {
    title: "Save Failed",
    description: "Shared content could not be saved.",
    systemImage: "xmark.circle",
  },
  empty: {
    title: "No Shared Content",
    description: "Teak did not receive anything to share.",
    systemImage: "tray",
  },
};

function getStatusConfig(status: IncomingShareStatus): StatusConfig {
  return STATUS_CONFIG_BY_STATUS[status];
}

export default function IncomingShareScreen() {
  const { errorDetail, handleClose, handleOpenLogin, status } =
    useIncomingShareImport();

  const config = getStatusConfig(status);
  const showCloseButton =
    status === "partial" || status === "error" || status === "empty";

  return (
    <Host matchContents style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack alignment="center" spacing={20}>
        <Spacer />
        <ContentUnavailableView
          description={errorDetail ?? config.description}
          systemImage={config.systemImage}
          title={config.title}
        />
        {showCloseButton ? (
          <Button
            modifiers={[
              buttonStyle("bordered"),
              controlSize("large"),
              tint(PlatformColor("label")),
            ]}
            onPress={handleClose}
          >
            <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
              Close
            </Text>
          </Button>
        ) : null}
        {status === "authRequired" ? (
          <Button
            modifiers={[
              buttonStyle("bordered"),
              controlSize("large"),
              tint(PlatformColor("label")),
            ]}
            onPress={handleOpenLogin}
          >
            <Text modifiers={[font({ design: "rounded", weight: "medium" })]}>
              Open Login
            </Text>
          </Button>
        ) : null}
        <Spacer />
      </VStack>
    </Host>
  );
}
