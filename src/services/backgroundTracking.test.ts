import { expect, it, vi } from "vitest";
import { newSession } from "../utils/session";
import {
  BackgroundTracker,
  type JournalApi,
  type NativeTrackingState,
} from "./backgroundTracking";
import type { TrackingRow } from "./trackingReplay";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

function fixture() {
  let state: NativeTrackingState | null = null;
  const rows: TrackingRow[] = [];
  const calls: string[] = [];
  const api: JournalApi = {
    notificationPermission: vi.fn(async () => ({ granted: true })),
    begin: vi.fn(async ({ session }) => {
      state = {
        session,
        elapsed: 0,
        paused: true,
        ended: false,
        watcher: null,
      };
    }),
    activate: vi.fn(async ({ watcher }) => {
      state!.watcher = watcher;
      state!.paused = false;
    }),
    read: vi.fn(async ({ after }) => ({
      state: state && { ...state },
      rows: rows.filter((r) => r.seq > after).slice(0, 500),
    })),
    pause: vi.fn(async ({ ended }) => {
      calls.push("freeze");
      state!.paused = true;
      state!.ended = ended;
    }),
    detached: vi.fn(async () => {
      state!.watcher = null;
    }),
    navigation: vi.fn(async () => {}),
    clear: vi.fn(async () => {
      calls.push("clear");
      state = null;
    }),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  };
  const gps: BackgroundGeolocationPlugin = {
    addWatcher: vi.fn(async () => {
      calls.push("watch");
      return "watcher";
    }),
    removeWatcher: vi.fn(async () => {
      calls.push("remove");
    }),
    openSettings: vi.fn(),
  };
  const permission = vi.fn(async () => ({
    location: "granted" as const,
    coarseLocation: "granted" as const,
  }));
  const update = vi.fn(),
    error = vi.fn();
  const tracker = new BackgroundTracker(
    "local-user",
    update,
    error,
    api,
    gps,
    permission,
  );
  const session = newSession("walk", 50, null);
  return { tracker, api, gps, permission, session, rows, calls, update, error };
}
it("starts one native watcher, serializes duplicate starts, and removes it before saving acknowledgement", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.tracker.start(f.session, "title", "message"),
    f.tracker.start(f.session, "title", "message"),
  ]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect(f.gps.addWatcher).toHaveBeenCalledOnce();
  expect(f.gps.addWatcher).toHaveBeenCalledWith(
    expect.objectContaining({
      distanceFilter: 0,
      requestPermissions: false,
      backgroundMessage: "message",
    }),
    expect.any(Function),
  );
  await f.tracker.pause(true);
  expect(f.calls).toEqual(["watch", "freeze", "remove"]);
  expect(f.api.clear).not.toHaveBeenCalled();
  await f.tracker.acknowledge(f.session.id);
  expect(f.calls.at(-1)).toBe("clear");
});
it("allows foreground fallback when notification permission is refused without starting a service", async () => {
  const f = fixture();
  vi.mocked(f.api.notificationPermission).mockResolvedValue({ granted: false });
  expect(await f.tracker.start(f.session, "title", "message")).toBe(false);
  expect(f.gps.addWatcher).not.toHaveBeenCalled();
  expect(f.api.begin).not.toHaveBeenCalled();
});
it("cleans a failed foreground-service promotion before offering foreground fallback", async () => {
  const f = fixture();
  vi.mocked(f.api.activate).mockRejectedValue(new Error("not visible"));
  expect(await f.tracker.start(f.session, "title", "message")).toBe(false);
  expect(f.calls).toEqual(["watch", "freeze", "remove", "clear"]);
});
it("pause/resume replaces rather than duplicates the watcher", async () => {
  const f = fixture();
  await f.tracker.start(f.session, "title", "message");
  await f.tracker.pause();
  await Promise.all([
    f.tracker.resume("title", "message"),
    f.tracker.resume("title", "message"),
  ]);
  expect(f.gps.addWatcher).toHaveBeenCalledTimes(2);
  expect(f.gps.removeWatcher).toHaveBeenCalledOnce();
});
it("reconciles an interrupted native stop before another watcher can start", async () => {
  const f = fixture();
  await f.tracker.start(f.session, "title", "message");
  await f.api.pause({ id: f.session.id, ended: false }); // WebView lost before removeWatcher
  const restored = new BackgroundTracker(
    "local-user",
    vi.fn(),
    vi.fn(),
    f.api,
    f.gps,
    f.permission,
  );
  const view = await restored.poll();
  expect(view?.paused).toBe(true);
  expect(f.gps.removeWatcher).toHaveBeenCalledOnce();
  await restored.resume("title", "message");
  expect(f.gps.addWatcher).toHaveBeenCalledTimes(2);
});
it("drains native observations on finish even when no JavaScript ran during capture, retaining them on save failure", async () => {
  const f = fixture();
  await f.tracker.start(f.session, "title", "message");
  f.rows.push(
    {
      seq: 1,
      kind: "point",
      elapsed: 0,
      receivedAt: 100000,
      point: {
        latitude: 0,
        longitude: 0,
        accuracy: 5,
        timestamp: 100000,
        speed: null,
      },
    },
    {
      seq: 2,
      kind: "point",
      elapsed: 3,
      receivedAt: 103000,
      point: {
        latitude: 0,
        longitude: 4 / 111194.9266,
        accuracy: 5,
        timestamp: 103000,
        speed: null,
      },
    },
  );
  const final = await f.tracker.pause(true);
  expect(final?.session.distance).toBeCloseTo(0.004, 5);
  expect(final?.session.measurements).toHaveLength(2);
  const restored = new BackgroundTracker(
    "local-user",
    vi.fn(),
    vi.fn(),
    f.api,
    f.gps,
    f.permission,
  );
  const recovered = await restored.poll();
  expect(recovered?.session.measurements).toEqual(final?.session.measurements);
  expect(recovered?.ended).toBe(true);
  expect(f.api.clear).not.toHaveBeenCalled();
});
