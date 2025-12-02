import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { colors } from "@/constants/colors";

export default function TabLayout() {
  return (
    <NativeTabs tintColor={colors.primary}>
      <NativeTabs.Trigger name="(home)">
        <Label selectedStyle={{ color: colors.primary }}>Home</Label>
        <Icon selectedColor={colors.primary} sf="house.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="add">
        <Label selectedStyle={{ color: colors.primary }}>Add</Label>
        <Icon selectedColor={colors.primary} sf="plus.circle.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Label selectedStyle={{ color: colors.primary }}>Settings</Label>
        <Icon selectedColor={colors.primary} sf="gearshape.fill" />
      </NativeTabs.Trigger>
      {/* <NativeTabs.Trigger name="search" role="search">
        <Label>Search</Label>
      </NativeTabs.Trigger> */}
    </NativeTabs>
  );
}
