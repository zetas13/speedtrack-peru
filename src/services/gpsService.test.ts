import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  requestPermissions: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: api }));
import { watchGps } from "./gpsService";
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
beforeEach(() => {
  api.requestPermissions.mockResolvedValue({ location: "granted" });
  api.watchPosition.mockResolvedValue("native-watch");
  api.clearWatch.mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());
it("native high accuracy uses a one-second desired interval independently of timeout", async () => {
  const error = vi.fn();
  const stop = watchGps(vi.fn(), error);
  await flush();
  expect(api.watchPosition).toHaveBeenCalledWith(
    expect.objectContaining({
      enableHighAccuracy: true,
      maximumAge: 0,
      interval: 1000,
      minimumUpdateInterval: 1000,
      timeout: 12000,
    }),
    expect.any(Function),
  );
  stop();
  expect(api.clearWatch).toHaveBeenCalledWith({ id: "native-watch" });
  expect(error).not.toHaveBeenCalled();
});
it("unmount while permissions are pending never starts a native watcher", async () => {
  let permit!: (value: { location: string }) => void;
  api.requestPermissions.mockImplementation(
    () =>
      new Promise((resolve) => {
        permit = resolve;
      }),
  );
  const stop = watchGps(vi.fn(), vi.fn());
  stop();
  permit({ location: "granted" });
  await flush();
  expect(api.watchPosition).not.toHaveBeenCalled();
});
it("denied native permissions report failure without crashing", async () => {
  api.requestPermissions.mockResolvedValue({
    location: "denied",
    coarseLocation: "denied",
  });
  const error = vi.fn();
  watchGps(vi.fn(), error);
  await flush();
  expect(error).toHaveBeenCalledOnce();
  expect(api.watchPosition).not.toHaveBeenCalled();
});
it("permission readiness precedes tracking and a transient error does not stop subsequent fixes", async () => {
  const point = vi.fn(),
    error = vi.fn(),
    ready = vi.fn();
  const stop = watchGps(point, error, ready);
  expect(ready).not.toHaveBeenCalled();
  await flush();
  expect(ready).toHaveBeenCalledOnce();
  const callback = api.watchPosition.mock.calls[0][1];
  callback(null, { code: "timeout" });
  callback({
    timestamp: 1000,
    coords: { latitude: 0, longitude: 0, accuracy: 5, speed: null },
  });
  expect(error).toHaveBeenCalledOnce();
  expect(point).toHaveBeenCalledWith({
    timestamp: 1000,
    latitude: 0,
    longitude: 0,
    accuracy: 5,
    speed: null,
  });
  stop();
  callback({ timestamp: 2000, coords: {} });
  expect(point).toHaveBeenCalledOnce();
});
it("approximate-only permission warns but keeps watching", async () => {
  api.requestPermissions.mockResolvedValue({
    location: "prompt",
    coarseLocation: "granted",
  });
  const error = vi.fn();
  watchGps(vi.fn(), error);
  await flush();
  expect(error).toHaveBeenCalledOnce();
  expect(api.watchPosition).toHaveBeenCalledOnce();
});

it("a watcher resolving after stop is removed and cannot deliver late fixes", async () => {
  let resolveWatch!: (id: string) => void;
  api.watchPosition.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveWatch = resolve;
      }),
  );
  const point = vi.fn();
  const stop = watchGps(point, vi.fn());
  await flush();
  stop();
  resolveWatch("late-watch");
  await flush();
  expect(api.clearWatch).toHaveBeenCalledExactlyOnceWith({ id: "late-watch" });
  api.watchPosition.mock.calls[0][1]({ timestamp: 1000, coords: {} });
  expect(point).not.toHaveBeenCalled();
});
