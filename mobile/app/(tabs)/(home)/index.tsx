import { CardsGrid } from "@/components/CardsGrid";
import { Stack } from "expo-router";

export default function HomeScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Home",
        }}
      />
      <CardsGrid />
    </>
  );
}
