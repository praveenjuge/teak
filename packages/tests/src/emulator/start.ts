import { createEmulator, type Emulator } from "@workos/emulate";
import { EMULATOR_PORT, emulatorSeed } from "./config";

// Hosted AuthKit asks for the password after the email, and its tokens name
// api.workos.com as the issuer; the emulator does both when told to.
export const startEmulator = (): Promise<Emulator> =>
  createEmulator({
    port: EMULATOR_PORT,
    seed: emulatorSeed,
    issuer: "https://api.workos.com",
    interactiveAuth: { password: true },
  });
