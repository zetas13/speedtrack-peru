import { describe, expect, it } from "vitest";
import { newSession } from "../utils/session";
import { TrackingReplay, type TrackingRow } from "./trackingReplay";
import { recentSpeed, userEta } from "../utils/navigation";

const point = (
  seq: number,
  seconds: number,
  meters: number,
  elapsed = seconds,
  accuracy = 5,
  speed: number | null = null,
): TrackingRow => ({
  seq,
  kind: "point",
  elapsed,
  receivedAt: 100000 + seconds * 1000,
  point: {
    timestamp: 100000 + seconds * 1000,
    latitude: 0,
    longitude: meters / 111194.9266,
    accuracy,
    speed,
  },
});
describe("durable GPS replay", () => {
  it.each([null, 0])(
    "replays locked-screen GPS with device speed %s exactly like foreground, with native time and ETA",
    (deviceSpeed) => {
      const session = newSession("walk", 50, null);
      const rows = Array.from({ length: 121 }, (_, i) =>
        point(i + 1, i, i * 1.4, i, 5, deviceSpeed),
      );
      const foreground = new TrackingReplay(session);
      for (const row of rows) foreground.apply([row]);
      const background = new TrackingReplay(session);
      background.apply(rows);
      background.time(120);
      expect(background.session.distance).toBeCloseTo(
        foreground.session.distance,
        8,
      );
      expect(background.session.distance).toBeGreaterThan(0.16);
      expect(background.session.measurements).toEqual(
        foreground.session.measurements,
      );
      const speed = recentSpeed(background.session.measurements, 120);
      expect(speed).toBeGreaterThan(3);
      expect(userEta(1, speed)).toBeGreaterThan(0);
      background.apply(rows); // repeated delivery, visibility events, retries
      expect(background.session.measurements).toHaveLength(121);
    },
  );
  it("pause/resume resets the anchor and excludes pause time without bridging movement", () => {
    const replay = new TrackingReplay(newSession("walk", 50, null));
    replay.apply([
      point(1, 0, 0),
      point(2, 3, 4),
      { seq: 3, kind: "break", elapsed: 3 },
      point(4, 100, 1000, 3),
      point(5, 103, 1004, 6),
    ]);
    expect(replay.session.distance).toBeCloseTo(0.008, 5);
    expect(replay.session.duration).toBe(6);
    expect(replay.session.measurements[2].break_before).toBe(true);
  });
  it("stationary jitter, poor fixes and signal loss do not invent distance in a buffer", () => {
    const replay = new TrackingReplay(newSession("walk", 50, null));
    replay.apply(
      Array.from({ length: 61 }, (_, i) => point(i + 1, i, Math.sin(i))),
    );
    expect(replay.session.distance).toBe(0);
    replay.apply([
      point(62, 61, 500, 61, 100),
      point(63, 100, 1000),
      point(64, 103, 1004),
    ]);
    expect(replay.session.distance).toBeCloseTo(0.004, 5);
    expect(replay.filter.diagnostics.discarded).toBe(1);
  });
  it("rebuilds after WebView recreation with stable sample IDs and a cursor across pages", () => {
    const session = newSession("walk", 50, null);
    const rows = Array.from({ length: 650 }, (_, i) => point(i + 1, i, i));
    const first = new TrackingReplay(session);
    first.apply(rows.slice(0, 200));
    const restored = new TrackingReplay(session);
    restored.apply(rows.slice(0, 500));
    restored.apply(rows.slice(500));
    first.apply(rows.slice(200));
    expect(restored.session).toEqual(first.session);
    expect(restored.after).toBe(650);
    expect(new Set(restored.session.measurements.map((m) => m.id)).size).toBe(
      650,
    );
  });
});
