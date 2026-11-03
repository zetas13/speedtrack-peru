import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "pe.speedtrack.app",
  appName: "SpeedTrack Perú",
  webDir: "dist",
  android: { backgroundColor: "#101512", useLegacyBridge: true },
};
export default config;
