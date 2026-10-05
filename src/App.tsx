import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Car,
  History,
  House,
  Navigation,
  UserRound,
} from "lucide-react";
import type { Session, Tab } from "./types";
import { I18nContext, translate } from "./i18n";
import { storageService } from "./services/storageService";
import {
  setVoiceLanguage,
  setVoiceVolume,
  stopSpeaking,
} from "./services/voiceService";
import { useSession } from "./hooks/useSession";
import { HomePage } from "./pages/HomePage";
import { TrackerPage } from "./pages/TrackerPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ProfilePage } from "./pages/ProfilePage";
import { DetailPage } from "./pages/DetailPage";
export default function App() {
  const [tab, setTab] = useState<Tab>("home"),
    [settings, setSettings] = useState(storageService.loadSettings),
    [sessions, setSessions] = useState(storageService.loadSessions),
    [detail, setDetail] = useState<Session | null>(null),
    [storageError, setStorageError] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef(sessions);
  const save = useCallback((s: Session) => {
    const next = [s, ...sessionsRef.current];
    sessionsRef.current = next;
    setSessions(next);
    setStorageError(!storageService.saveSessions(next));
  }, []);
  const tracker = useSession(settings, save);
  const t = (key: Parameters<typeof translate>[1]) =>
    translate(settings.language, key);
  useEffect(() => {
    document.documentElement.lang =
      settings.language === "qu" ? "qu-PE" : settings.language;
    setVoiceLanguage(settings.voice_language);
    setVoiceVolume(settings.voice_volume);
    if (!settings.voice_enabled) stopSpeaking();
    setStorageError(!storageService.saveSettings(settings));
  }, [settings]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [tab, detail, tracker.completed]);
  const navigate = (next: Tab) => {
    setTab(next);
    setDetail(null);
    tracker.clearCompleted();
  };
  const open = (s: Session) => setDetail(s);
  const closeDetail = () => {
    setDetail(null);
    tracker.clearCompleted();
  };
  const shown = detail ?? tracker.completed;
  return (
    <I18nContext.Provider value={settings.language}>
      <div className="app-shell">
        <div className="top-bar">
          <span>
            <Navigation size={12} />
            {t("app")}
          </span>
          <span className="top-bar-indicator" />
        </div>
        <main className="app-content" ref={scroll}>
          {storageError && (
            <div className="error-message" role="alert">
              {t("storageError")}
            </div>
          )}
          {shown ? (
            <DetailPage
              session={shown}
              onBack={closeDetail}
              summary={!detail}
            />
          ) : tab === "home" ? (
            <HomePage sessions={sessions} navigate={navigate} open={open} />
          ) : tab === "activity" || tab === "vehicle" ? (
            <TrackerPage
              vehicle={tab === "vehicle"}
              session={tracker.session}
              paused={tracker.paused}
              gpsError={tracker.gpsError}
              settings={settings}
              setLimit={(v) => setSettings((s) => ({ ...s, speed_limit: v }))}
              start={tracker.start}
              finish={tracker.finish}
              togglePause={tracker.togglePause}
            />
          ) : tab === "history" ? (
            <HistoryPage sessions={sessions} open={open} />
          ) : (
            <ProfilePage settings={settings} update={setSettings} />
          )}
        </main>
        <nav className="bottom-nav" aria-label={t("app")}>
          {(
            [
              { key: "home", Icon: House },
              { key: "activity", Icon: Activity },
              { key: "vehicle", Icon: Car },
              { key: "history", Icon: History },
              { key: "profile", Icon: UserRound },
            ] as const
          ).map(({ key, Icon }) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              <span>
                <Icon size={21} />
                {tracker.session &&
                  ((key === "vehicle" && tracker.session.type === "vehicle") ||
                    (key === "activity" &&
                      tracker.session.type !== "vehicle")) && (
                    <i className="nav-live" />
                  )}
              </span>
              {t(key)}
            </button>
          ))}
        </nav>
      </div>
    </I18nContext.Provider>
  );
}
