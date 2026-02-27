import { Stack } from "expo-router";

export default function Layout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "Add",
          headerLargeTitle: true,
        }}
      />
      <Stack.Screen
        name="text"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: [0.5, 1.0],
          sheetGrabberVisible: true,
          title: "Text or URL",
        }}
      />
      <Stack.Screen
        name="record"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: [0.5],
          sheetGrabberVisible: true,
          title: "Record Audio",
        }}
      />
    </Stack>
  );
}
