import { useEffect, useRef, useState } from "react";
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
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useActivityStore } from './hooks/useActivityStore';
import { AccountPanel } from './components/AccountPanel';
import { supabase } from './services/supabase';
export default function App() { return <AuthProvider><OwnedApp /></AuthProvider>; }
function OwnedApp() {const {user} = useAuth(); return <Workspace key={user?.id ?? 'local-user'} owner={user?.id ?? 'local-user'} />;}
function Workspace({owner}: {owner: string}) {
  const [tab, setTab] = useState<Tab>("home"),
    [settings, setSettings] = useState(() => storageService.loadSettings(owner)),
    [detail, setDetail] = useState<Session | null>(null),
    [storageError, setStorageError] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const {sessions, save, storageError: historyError, syncState, sync, importLocal} = useActivityStore(owner);
  const {recovery} = useAuth();
  const settingsDirty = useRef(false);
  useEffect(() => {
    if (!supabase || owner === 'local-user') return;
    let live = true;
    void supabase.from('user_settings').select('payload').eq('user_id', owner).maybeSingle().then(({data}) => {
      if (live && data && !settingsDirty.current) {
        storageService.saveSettings(data.payload, owner);
        setSettings(storageService.loadSettings(owner));
      }
    });
    return () => { live = false; };
  }, [owner]);
  const updateSettings = (next: typeof settings) => {
    settingsDirty.current = true; setSettings(next);
  };
  const tracker = useSession(settings, save, owner);
  const t = (key: Parameters<typeof translate>[1]) =>
    translate(settings.language, key);
  useEffect(() => {
    document.documentElement.lang =
      settings.language === "qu" ? "qu-PE" : settings.language;
    setVoiceLanguage(settings.voice_language);
    setVoiceVolume(settings.voice_volume);
    if (!settings.voice_enabled) stopSpeaking();
    setStorageError(!storageService.saveSettings(settings, owner));
    if (owner !== 'local-user' && supabase && settingsDirty.current) {
      const timer = window.setTimeout(() => {
        void supabase!.from('user_settings').upsert({user_id: owner, payload: settings}).then(({error}) => {if (error) setStorageError(true);});
      }, 700);
      return () => window.clearTimeout(timer);
    }
  }, [settings, owner]);
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
          {(storageError || historyError || tracker.draftError) && (
            <div className="error-message" role="alert">
              {t("storageError")}
            </div>
          )}
          {tracker.draft && !tracker.session && <button className="secondary-button full" onClick={tracker.recoverDraft}>{t("recoverDraft")}</button>}
          {owner !== 'local-user' && <button className="sync-status" onClick={() => void sync()}>{t(syncState)}</button>}
          {recovery ? <AccountPanel active={!!tracker.session} importLocal={importLocal} /> : shown ? (
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
              setLimit={(v) => updateSettings({ ...settings, speed_limit: v })}
              updateNavigation={tracker.updateNavigation}
              start={tracker.start}
              finish={tracker.finish}
              togglePause={tracker.togglePause}
            />
          ) : tab === "history" ? (
            <HistoryPage sessions={sessions} open={open} />
          ) : (
            <><AccountPanel active={!!tracker.session} importLocal={importLocal} /><ProfilePage settings={settings} update={updateSettings} /></>
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
