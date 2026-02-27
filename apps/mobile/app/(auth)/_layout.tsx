import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen
        name="sign-in"
        options={{
          presentation: "formSheet",
          sheetGrabberVisible: true,
          headerShown: true,
          title: "Welcome Back",
        }}
      />
      <Stack.Screen
        name="sign-up"
        options={{
          presentation: "formSheet",
          sheetGrabberVisible: true,
          headerShown: true,
          title: "Create an Account",
        }}
      />
    </Stack>
  );
}
