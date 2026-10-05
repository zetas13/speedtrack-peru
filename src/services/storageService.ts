import type { Session, Settings, User } from "../types";
import { seedSessions } from "../data/seed";
export const defaultSettings: Settings = {
  id: "local-settings",
  user_id: "local-user",
  language: "es",
  units: "metric",
  voice_enabled: false,
  voice_language: "es",
  voice_volume: 0.8,
  kilometer_alerts: true,
  safety_alerts: true,
  approaching_alerts: true,
  speed_limit: 50,
};
const read = (key: string): unknown => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
export const storageService = {
  loadSessions(): Session[] {
    const data = read("speedtrack.sessions.v1");
    if (!Array.isArray(data)) return seedSessions();
    const valid = data.filter(
      (s): s is Session =>
        !!s &&
        typeof s.id === "string" &&
        ["walk", "run", "bike", "vehicle"].includes(s.type) &&
        Number.isFinite(s.duration) &&
        Number.isFinite(s.distance) &&
        typeof s.start_time === "string" &&
        Number.isFinite(Date.parse(s.start_time)) &&
        Array.isArray(s.measurements) &&
        Array.isArray(s.splits) &&
        Array.isArray(s.events),
    );
    return valid;
  },
  saveSessions(sessions: Session[]) {
    try {
      localStorage.setItem("speedtrack.sessions.v1", JSON.stringify(sessions));
      return true;
    } catch {
      return false;
    }
  },
  loadSettings(): Settings {
    const raw = read("speedtrack.settings.v1");
    if (!raw || typeof raw !== "object") return defaultSettings;
    const s = raw as Partial<Settings>;
    return {
      ...defaultSettings,
      ...s,
      units: "metric",
      voice_volume:
        typeof s.voice_volume === "number" && Number.isFinite(s.voice_volume)
          ? Math.max(0, Math.min(1, s.voice_volume))
          : defaultSettings.voice_volume,
      voice_enabled:
        typeof s.voice_enabled === "boolean"
          ? s.voice_enabled
          : defaultSettings.voice_enabled,
      kilometer_alerts:
        typeof s.kilometer_alerts === "boolean"
          ? s.kilometer_alerts
          : defaultSettings.kilometer_alerts,
      safety_alerts:
        typeof s.safety_alerts === "boolean"
          ? s.safety_alerts
          : defaultSettings.safety_alerts,
      approaching_alerts:
        typeof s.approaching_alerts === "boolean"
          ? s.approaching_alerts
          : defaultSettings.approaching_alerts,
      language: ["es", "en", "qu"].includes(s.language ?? "")
        ? s.language!
        : "es",
      voice_language: ["es", "en", "qu"].includes(s.voice_language ?? "")
        ? s.voice_language!
        : "es",
      speed_limit:
        typeof s.speed_limit === "number" &&
        s.speed_limit >= 10 &&
        s.speed_limit <= 130
          ? s.speed_limit
          : 50,
    };
  },
  saveSettings(settings: Settings) {
    try {
      localStorage.setItem("speedtrack.settings.v1", JSON.stringify(settings));
      const user: User = {
        id: "local-user",
        name: "",
        email: "",
        language: settings.language,
        voice_enabled: settings.voice_enabled,
      };
      localStorage.setItem("speedtrack.user.v1", JSON.stringify(user));
      return true;
    } catch {
      return false;
    }
  },
};
