import { Tabs } from "expo-router";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { HapticTab } from "@/components/HapticTab";
import { Platform } from "react-native";
import TabBarBackground from "@/components/ui/TabBarBackground";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarHideOnKeyboard: true,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            // Use a transparent background on iOS to show the blur effect
            position: "absolute",
          },
          default: {},
        }),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <IconSymbol
              name={focused ? "house.fill" : "house"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: "Add Card",
          tabBarLabel: "Add",
          tabBarIcon: ({ color, size, focused }) => (
            <IconSymbol
              name={focused ? "plus.circle.fill" : "plus.circle"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size, focused }) => (
            <IconSymbol
              name={focused ? "gearshape.fill" : "gearshape"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
