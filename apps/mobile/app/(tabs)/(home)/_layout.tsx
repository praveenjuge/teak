import { Stack } from "expo-router";

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="card/[id]"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: [0.5, 1.0],
          sheetGrabberVisible: true,
          title: "Preview",
        }}
      />
    </Stack>
  );
}
