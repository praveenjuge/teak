import { CardsGrid } from "@/components/CardsGrid";
import { Stack } from "expo-router";
import { ScrollView } from "react-native";

export default function HomeScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Home",
        }}
      />
      <ScrollView>
        <CardsGrid />
      </ScrollView>
    </>
  );
}
