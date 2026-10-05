import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityType, Session, Settings, SpeedStatus } from "../types";
import { DEMO_SECONDS, demoMeasurement, newSession } from "../data/demo";
import {
  addMeasurement,
  calculateAcceleration,
  calculateAveragePace,
  calculateDistance,
  classifySpeedStatus,
} from "../utils/physics";
import { watchGps, type GpsPoint } from "../services/gpsService";
import { speak, stopSpeaking } from "../services/voiceService";
import { translate } from "../i18n";
export function useSession(
  settings: Settings,
  onSave: (session: Session) => void,
) {
  const [session, setSession] = useState<Session | null>(null),
    [paused, setPaused] = useState(false),
    [gpsError, setGpsError] = useState(false),
    [completed, setCompleted] = useState<Session | null>(null);
  const current = useRef<Session | null>(null),
    pausedRef = useRef(false),
    stopGps = useRef<() => void>(() => {}),
    clock = useRef(0),
    lastPoint = useRef<GpsPoint | null>(null),
    lastStatus = useRef<SpeedStatus>("normal"),
    lastVoice = useRef(0),
    settingsRef = useRef(settings),
    saveRef = useRef(onSave),
    timeAlert = useRef(false);
  useEffect(() => {
    settingsRef.current = settings;
    saveRef.current = onSave;
  }, [settings, onSave]);
  const announce = useCallback(
    (
      key: Parameters<typeof translate>[1],
      values?: Record<string, string | number>,
    ) => {
      const s = settingsRef.current;
      if (s.voice_enabled) speak(translate(s.voice_language, key, values));
    },
    [],
  );
  const finish = useCallback(() => {
    const s = current.current;
    if (!s) return;
    stopGps.current();
    current.current = null;
    const result = { ...s, end_time: new Date().toISOString() };
    saveRef.current(result);
    setCompleted(result);
    setSession(null);
    setPaused(false);
    stopSpeaking();
    announce(s.type === "vehicle" ? "vehicleFinishVoice" : "finishVoice");
  }, [announce]);
  const commit = useCallback(
    (next: Session) => {
      const prev = current.current;
      if (!prev) return;
      current.current = next;
      setSession(next);
      const config = settingsRef.current;
      if (
        next.splits.length > prev.splits.length &&
        config.kilometer_alerts &&
        next.type !== "vehicle"
      ) {
        const p = Math.round(
          calculateAveragePace(next.distance, next.duration),
        );
        announce("kilometerVoice", {
          value: next.splits.length,
          minutes: Math.floor(p / 60),
          seconds: p % 60,
        });
      }
      if (
        next.type !== "vehicle" &&
        prev.splits.length > 0 &&
        next.splits.length > prev.splits.length &&
        next.splits.at(-1)!.pace < Math.min(...prev.splits.map((s) => s.pace))
      )
        announce("bestVoice");
      if (
        next.type !== "vehicle" &&
        next.duration >= 1800 &&
        !timeAlert.current
      ) {
        timeAlert.current = true;
        announce("timeVoice");
      }
      if (next.type === "vehicle") {
        const speed = next.measurements.at(-1)?.speed ?? 0,
          status = classifySpeedStatus(speed, next.limit);
        if (status !== lastStatus.current) {
          if (status === "caution" && config.approaching_alerts)
            announce("approachingVoice");
          if (status === "over" && config.safety_alerts) announce("overVoice");
          lastStatus.current = status;
        }
        if (config.safety_alerts && next.events.length > prev.events.length) {
          const event = next.events.at(-1);
          if (event?.type === "brake") announce("brakeVoice");
          if (event?.type === "accelerate") announce("accelerateVoice");
        }
        if (config.safety_alerts && next.duration - lastVoice.current >= 15) {
          lastVoice.current = next.duration;
          announce("speedVoice", { value: Math.round(speed) });
        }
      }
    },
    [announce],
  );
  const start = useCallback(
    (type: ActivityType, demo: boolean, goal: number | null) => {
      stopGps.current();
      stopSpeaking();
      const s = newSession(type, demo, settingsRef.current.speed_limit, goal);
      current.current = s;
      setSession(s);
      setPaused(false);
      pausedRef.current = false;
      setGpsError(false);
      setCompleted(null);
      clock.current = 0;
      lastPoint.current = null;
      lastStatus.current = "normal";
      lastVoice.current = 0;
      timeAlert.current = false;
      if (!demo)
        stopGps.current = watchGps(
          (point) => {
            const live = current.current;
            if (!live || pausedRef.current) return;
            const previous = lastPoint.current;
            if (previous && point.timestamp <= previous.timestamp) return;
            lastPoint.current = point;
            const prior = live.measurements.at(-1);
            const dt = prior ? clock.current - prior.elapsed : 0; // First fix after pause establishes a new position baseline.
            const delta = previous ? calculateDistance(previous, point) : 0;
            const plausible = previous && dt > 0 && (delta / dt) * 3600 < 250;
            const acceptedDelta =
              plausible &&
              delta * 1000 > Math.max(point.accuracy, previous.accuracy) * 0.3
                ? delta
                : 0;
            const speed =
              point.speed !== null && point.speed >= 0
                ? point.speed * 3.6
                : dt > 0
                  ? (acceptedDelta / dt) * 3600
                  : 0;
            commit(
              addMeasurement(live, {
                id: crypto.randomUUID(),
                session_id: live.id,
                timestamp: point.timestamp,
                elapsed: clock.current,
                latitude: point.latitude,
                longitude: point.longitude,
                accuracy: point.accuracy,
                speed,
                acceleration: calculateAcceleration(
                  prior?.speed ?? speed,
                  speed,
                  dt,
                ),
                distance: live.distance + acceptedDelta,
              }),
            );
            setGpsError(false);
          },
          () => {
            setGpsError(true);
          },
        );
    },
    [commit],
  );
  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(() => {
      const live = current.current;
      if (!live || pausedRef.current) return;
      clock.current += 1;
      if (live.demo) {
        commit(addMeasurement(live, demoMeasurement(live, clock.current)));
        if (clock.current >= DEMO_SECONDS) finish();
      } else {
        const next = {
          ...live,
          duration: clock.current,
          avg_speed:
            clock.current > 0 ? (live.distance / clock.current) * 3600 : 0,
        };
        current.current = next;
        setSession(next);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionId, commit, finish]); // A stable session id owns exactly one timer.
  useEffect(
    () => () => {
      stopGps.current();
      stopSpeaking();
    },
    [],
  );
  const togglePause = () => {
    const value = !pausedRef.current;
    pausedRef.current = value;
    setPaused(value);
    lastPoint.current = null;
    stopSpeaking();
    announce(value ? "pauseVoice" : "resumeVoice");
  };
  return {
    session,
    paused,
    gpsError,
    completed,
    start,
    finish,
    togglePause,
    clearCompleted: () => setCompleted(null),
  };
}
