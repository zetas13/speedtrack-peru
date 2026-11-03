import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityType,
  Session,
  Settings,
  SpeedStatus,
  NavigationPlan,
} from "../types";
import { DEMO_SECONDS, demoMeasurement, newSession } from "../data/demo";
import {
  addMeasurement,
  calculateAveragePace,
  calculateDistance,
  classifySpeedStatus,
} from "../utils/physics";
import { navigationForMode } from "../services/routingService";
import { watchGps } from "../services/gpsService";
import { announceVoice, stopSpeaking } from "../services/voiceService";
import { translate } from "../i18n";
import { gpsPolicy, GpsFilter } from "../utils/gpsFilter";
import { draftService } from "../services/draftService";
import { routeProgress, recentSpeed, userEta } from "../utils/navigation";
import {
  BackgroundTracker,
  backgroundSupported,
} from "../services/backgroundTracking";
export function useSession(
  settings: Settings,
  onSave: (session: Session) => boolean,
  owner = "local-user",
) {
  const [session, setSession] = useState<Session | null>(null),
    [paused, setPaused] = useState(false),
    [gpsError, setGpsError] = useState(false),
    [completed, setCompleted] = useState<Session | null>(null);
  const [waitingFix, setWaitingFix] = useState(false);
  const [emptyActivity, setEmptyActivity] = useState(false);
  const permissionPending = useRef(false);
  const nativeTracker = useRef<BackgroundTracker | null>(null);
  const nativeMode = useRef(false);
  const nativeDiagnostics = useRef<object | null>(null);
  const busyRef = useRef(false);
  const [trackingBusy, setTrackingBusy] = useState(backgroundSupported);
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [backgroundError, setBackgroundError] = useState(false);
  const [trackingUnavailable, setTrackingUnavailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const target = window as unknown as {
      speedtrackGpsDiagnostics?: () => unknown;
    };
    target.speedtrackGpsDiagnostics = () => ({
      ...(nativeDiagnostics.current ?? filter.current.diagnostics),
    });
    return () => {
      delete target.speedtrackGpsDiagnostics;
    };
  }, []);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const lastGpsWarning = useRef(-Infinity);
  const lastProgress = useRef(0);
  const [draftError, setDraftError] = useState(false);
  const [draft, setDraft] = useState(() => draftService.read(owner));
  const current = useRef<Session | null>(null),
    pausedRef = useRef(false),
    stopGps = useRef<() => void>(() => {}),
    clock = useRef(0),
    filter = useRef(new GpsFilter()),
    tickAt = useRef(0),
    lastStatus = useRef<SpeedStatus>("normal"),
    lastVoice = useRef(0),
    settingsRef = useRef(settings),
    saveRef = useRef(onSave),
    timeAlert = useRef(false);
  const arrived = useRef(false);
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
      if (s.voice_enabled)
        announceVoice(
          key,
          values,
          ["overVoice", "brakeVoice", "lowAccuracyVoice"].includes(key)
            ? 10
            : 0,
        );
    },
    [],
  );
  const finish = useCallback(async () => {
    let s = current.current;
    if (!s || busyRef.current) return;
    busyRef.current = true;
    setTrackingBusy(true);
    try {
      if (nativeMode.current) {
        const drained = await nativeTracker.current!.pause(true);
        if (!drained) throw new Error("Missing native session");
        s = drained.session;
      }
      stopGps.current();
      current.current = null;
      if (!s.demo && s.distance <= 0) {
        draftService.clear(owner);
        setDraft(null);
        setSession(null);
        setPaused(false);
        setEmptyActivity(true);
        stopSpeaking();
        if (nativeMode.current) await nativeTracker.current!.acknowledge(s.id);
        nativeMode.current = false;
        setBackgroundActive(false);
        return;
      }
      const result = { ...s, end_time: new Date().toISOString() };
      if (saveRef.current(result)) {
        if (nativeMode.current) await nativeTracker.current!.acknowledge(s.id);
        draftService.clear(owner);
        setDraft(null);
      } else {
        draftService.write(result);
        setDraft(result);
        setDraftError(true);
      }
      setCompleted(result);
      setSession(null);
      setPaused(false);
      nativeMode.current = false;
      setBackgroundActive(false);
      stopSpeaking();
      announce(s.type === "vehicle" ? "vehicleFinishVoice" : "finishVoice");
    } catch {
      setBackgroundError(true);
      // Keep a recoverable session if stop, drain or durable acknowledgement fails.
      if (s) {
        current.current = s;
        setSession(s);
      }
    } finally {
      busyRef.current = false;
      setTrackingBusy(false);
    }
  }, [announce, owner]);
  const commit = useCallback(
    (next: Session) => {
      const prev = current.current;
      if (!prev) return;
      current.current = next;
      setSession(next);
      // Persist each accepted observation, including the first movement.
      setDraftError(!draftService.write(next));
      const config = settingsRef.current;
      const last = next.measurements.at(-1);
      if (
        !arrived.current &&
        next.navigation?.route &&
        last?.longitude != null &&
        last.latitude != null
      ) {
        const progress = routeProgress(
          [last.longitude, last.latitude],
          next.navigation.route.coordinates,
        );
        if (
          !progress.offRoute &&
          progress.remaining < 0.02 &&
          (last.accuracy ?? 0) <= 25 &&
          calculateDistance(
            { latitude: last.latitude, longitude: last.longitude },
            {
              latitude: next.navigation.destination[1],
              longitude: next.navigation.destination[0],
            },
          ) < 0.02
        ) {
          arrived.current = true;
          announce("arrivalVoice");
        }
      }
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
      if (
        config.progress_alerts &&
        next.duration - lastProgress.current >= 60
      ) {
        lastProgress.current = next.duration;
        const speed = recentSpeed(next.measurements, next.duration);
        const pace = speed > 0 ? Math.round(3600 / speed) : 0;
        announce("progressVoice", {
          distance: next.distance.toFixed(2),
          minutes: Math.floor(next.duration / 60),
          value: speed.toFixed(1),
        });
        if ((next.type === "walk" || next.type === "run") && pace > 0)
          announce("paceVoice", {
            minutes: Math.floor(pace / 60),
            seconds: pace % 60,
          });
        if (
          next.navigation?.route &&
          last?.longitude != null &&
          last.latitude != null
        ) {
          const progress = routeProgress(
            [last.longitude, last.latitude],
            next.navigation.route.coordinates,
          );
          if (!progress.offRoute) {
            announce("remainingVoice", {
              value: progress.remaining.toFixed(2),
            });
            const eta = userEta(progress.remaining, speed);
            if (eta !== null)
              announce("etaVoice", { minutes: Math.ceil(eta / 60) });
          }
        }
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
    async (
      type: ActivityType,
      demo: boolean,
      goal: number | null,
      navigation?: NavigationPlan,
      background = false,
    ) => {
      if (busyRef.current || current.current || draftService.read(owner))
        return;
      busyRef.current = true;
      setTrackingBusy(true);
      stopGps.current();
      stopSpeaking();
      const s = newSession(type, demo, settingsRef.current.speed_limit, goal);
      s.user_id = owner;
      s.navigation = navigationForMode(navigation, type);
      current.current = s;
      setDraftError(!draftService.write(s));
      setSession(s);
      setPaused(false);
      pausedRef.current = false;
      setGpsError(false);
      setCompleted(null);
      setEmptyActivity(false);
      setBackgroundError(false);
      nativeDiagnostics.current = null;
      clock.current = 0;
      tickAt.current = performance.now();
      filter.current = new GpsFilter();
      lastStatus.current = "normal";
      lastVoice.current = 0;
      timeAlert.current = false;
      arrived.current = false;
      lastProgress.current = 0;
      lastGpsWarning.current = -Infinity;
      setGpsAccuracy(null);
      setWaitingFix(!demo);
      permissionPending.current = !demo;
      announce("startVoice");
      if (!demo && background && nativeTracker.current) {
        try {
          const language = settingsRef.current.language;
          if (
            await nativeTracker.current.start(
              s,
              translate(language, "backgroundTitle"),
              translate(language, "backgroundNotification"),
            )
          ) {
            nativeMode.current = true;
            setBackgroundActive(true);
            permissionPending.current = false;
            busyRef.current = false;
            setTrackingBusy(false);
            return;
          }
          setBackgroundError(true);
        } catch {
          // A failed service start must not silently claim background protection.
          setBackgroundError(true);
          try {
            if (await nativeTracker.current.poll()) {
              permissionPending.current = false;
              busyRef.current = false;
              setTrackingBusy(false);
              return;
            }
          } catch {
            // Unknown native state: keep recovery available instead of starting
            // a second sensor or overwriting an unacknowledged journal.
            nativeMode.current = true;
            setPaused(true);
            pausedRef.current = true;
            permissionPending.current = false;
            busyRef.current = false;
            setTrackingBusy(false);
            return;
          }
        }
      }
      nativeMode.current = false;
      setBackgroundActive(false);
      if (!demo)
        stopGps.current = watchGps(
          (point) => {
            const live = current.current;
            if (!live || pausedRef.current) return;
            setGpsAccuracy(point.accuracy);
            if (
              point.accuracy > gpsPolicy.maxAccuracyM &&
              clock.current - lastGpsWarning.current >= 60
            ) {
              lastGpsWarning.current = clock.current;
              announce("lowAccuracyVoice");
            }
            const accepted = filter.current.accept(
              point,
              live.type,
              Date.now(),
            );
            if (!accepted) return;
            setWaitingFix(false);
            commit(
              addMeasurement(live, {
                id: crypto.randomUUID(),
                session_id: live.id,
                timestamp: point.timestamp,
                elapsed: clock.current,
                latitude: point.latitude,
                longitude: point.longitude,
                accuracy: point.accuracy,
                device_speed: point.speed,
                break_before: accepted.breakBefore,
                speed: accepted.speed,
                instantaneous_speed: accepted.instantaneousSpeed,
                acceleration: accepted.acceleration,
                distance: live.distance + accepted.delta,
              }),
            );
            setGpsError(false);
          },
          () => {
            setGpsError(true);
          },
          () => {
            permissionPending.current = false;
          },
        );
      busyRef.current = false;
      setTrackingBusy(false);
    },
    [commit, owner, announce],
  );
  useEffect(() => {
    if (!backgroundSupported()) return;
    let live = true;
    let unlisten: (() => void) | undefined;
    busyRef.current = true;
    const tracker = new BackgroundTracker(
      owner,
      (view) => {
        if (!live) return;
        nativeMode.current = true;
        nativeDiagnostics.current = view.diagnostics;
        setBackgroundActive(!view.ended);
        current.current ??= view.session;
        clock.current = view.session.duration;
        commit(view.session);
        pausedRef.current = view.paused;
        setPaused(view.paused);
        setWaitingFix(view.waitingFix);
        setGpsAccuracy(view.accuracy);
      },
      () => {
        if (live) setBackgroundError(true);
      },
    );
    nativeTracker.current = tracker;
    void (async () => {
      try {
        const release = await tracker.listen();
        if (!live) {
          release();
          return;
        }
        unlisten = release;
        const restored = await tracker.poll();
        if (!live) return;
        if (restored?.ended) {
          current.current = null;
          setSession(null);
          setDraft(restored.session);
          nativeMode.current = false;
        }
      } catch {
        if (live) {
          setBackgroundError(true);
          setTrackingUnavailable(true);
        }
      } finally {
        if (live) {
          busyRef.current = false;
          setTrackingBusy(false);
        }
      }
    })();
    return () => {
      live = false;
      unlisten?.();
    };
  }, [commit, owner]);
  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(() => {
      const live = current.current;
      if (!live || pausedRef.current) return;
      if (nativeMode.current) {
        void nativeTracker.current
          ?.poll()
          .catch(() => setBackgroundError(true));
        return;
      }
      const now = performance.now();
      const dt = Math.max(0, (now - tickAt.current) / 1000);
      tickAt.current = now;
      clock.current += live.demo ? 1 : dt;
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
        if (Math.floor(next.duration) % 5 === 0)
          setDraftError(!draftService.write(next));
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
  useEffect(() => {
    const hide = () => {
      if (nativeMode.current) {
        if (!document.hidden)
          void nativeTracker.current
            ?.poll()
            .catch(() => setBackgroundError(true));
        return;
      }
      if (!document.hidden || !current.current || permissionPending.current)
        return;
      pausedRef.current = true;
      setPaused(true);
      filter.current.reset();
      setWaitingFix(!current.current.demo);
      setDraftError(!draftService.write(current.current));
      stopSpeaking();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  const togglePause = async () => {
    if (busyRef.current) return;
    if (nativeMode.current) {
      busyRef.current = true;
      setTrackingBusy(true);
      try {
        if (pausedRef.current) {
          const language = settingsRef.current.language;
          await nativeTracker.current!.resume(
            translate(language, "backgroundTitle"),
            translate(language, "backgroundNotification"),
          );
        } else await nativeTracker.current!.pause();
        stopSpeaking();
        announce(pausedRef.current ? "pauseVoice" : "resumeVoice");
      } catch {
        setBackgroundError(true);
      } finally {
        busyRef.current = false;
        setTrackingBusy(false);
      }
      return;
    }
    const value = !pausedRef.current;
    pausedRef.current = value;
    setPaused(value);
    tickAt.current = performance.now();
    if (current.current) setDraftError(!draftService.write(current.current));
    filter.current.reset();
    setWaitingFix(!current.current?.demo);
    stopSpeaking();
    announce(value ? "pauseVoice" : "resumeVoice");
  };
  return {
    session,
    draftError,
    draft,
    emptyActivity,
    trackingBusy,
    trackingUnavailable,
    backgroundActive,
    backgroundError,
    recoverDraft: async () => {
      if (!draft || busyRef.current) return;
      busyRef.current = true;
      setTrackingBusy(true);
      try {
        if (!draft.demo && draft.distance <= 0) {
          if (backgroundSupported())
            await nativeTracker.current?.acknowledge(draft.id);
          draftService.clear(owner);
          setDraft(null);
          setEmptyActivity(true);
          return;
        }
        const recovered = {
          ...draft,
          end_time:
            draft.end_time ??
            new Date(
              Date.parse(draft.start_time) + draft.duration * 1000,
            ).toISOString(),
        };
        if (saveRef.current(recovered)) {
          if (backgroundSupported())
            await nativeTracker.current?.acknowledge(draft.id);
          draftService.clear(owner);
          setDraft(null);
          setDraftError(false);
        }
      } catch {
        setBackgroundError(true);
      } finally {
        busyRef.current = false;
        setTrackingBusy(false);
      }
    },
    paused,
    gpsError,
    gpsAccuracy,
    waitingFix,
    completed,
    start,
    finish,
    togglePause,
    updateNavigation: (navigation: NavigationPlan | undefined) => {
      if (!current.current) return;
      if (
        navigation?.destination.join(",") !==
        current.current.navigation?.destination.join(",")
      )
        arrived.current = false;
      const next = { ...current.current, navigation };
      current.current = next;
      setSession(next);
      setDraftError(!draftService.write(next));
      if (nativeMode.current)
        void nativeTracker.current
          ?.navigation(navigation)
          .catch(() => setBackgroundError(true));
    },
    clearCompleted: () => setCompleted(null),
  };
}
