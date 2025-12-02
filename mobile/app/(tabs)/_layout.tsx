import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { colors } from "@/constants/colors";

export default function TabLayout() {
  return (
    <NativeTabs tintColor={colors.primary} iconColor={colors.primary}>
      <NativeTabs.Trigger name="(home)">
        <Label>Home</Label>
        <Icon selectedColor={colors.primary} sf="house" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="add">
        <Label>Add</Label>
        <Icon selectedColor={colors.primary} sf="plus.circle.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Label>Settings</Label>
        <Icon selectedColor={colors.primary} sf="gearshape" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <Label>Search</Label>
        <Icon selectedColor={colors.primary} sf="magnifyingglass" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
