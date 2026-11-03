import { test, expect, type Page } from "@playwright/test";

// Native bridge contract emulation. SQLite is tested separately on Robolectric;
// this does not claim to emulate Android battery management or a physical GPS.
async function android(page: Page, notifications = true) {
  await page.route("https://tiles.openfreemap.org/**", (r) =>
    r.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
  );
  await page.route("https://fonts.googleapis.com/**", (r) =>
    r.fulfill({ body: "" }),
  );
  await page.route("https://speedtrack-test.supabase.co/**", (r) =>
    r.fulfill({ json: [] }),
  );
  await page.addInitScript(
    ({ notifications }) => {
      type State = {
        session: Record<string, unknown>;
        elapsed: number;
        paused: boolean;
        ended: boolean;
        watcher: string | null;
      };
      type Row = {
        seq: number;
        kind: string;
        elapsed: number;
        receivedAt?: number;
        point?: object;
      };
      const saved = JSON.parse(
        sessionStorage.getItem("native-journal-test") || "null",
      ) as {
        state: State | null;
        rows: Row[];
        watchers: number;
        stops: number;
        notificationRequests: number;
        locationRequests: number;
        time: number;
      } | null;
      const db = saved ?? {
        state: null,
        rows: [],
        watchers: 0,
        stops: 0,
        notificationRequests: 0,
        locationRequests: 0,
        time: Date.now(),
      };
      const listeners = new Map<string, () => void>();
      let deliver = true;
      const persist = () =>
        sessionStorage.setItem("native-journal-test", JSON.stringify(db));
      const boundary = () =>
        db.rows.push({
          seq: db.rows.length + 1,
          kind: "break",
          elapsed: db.state!.elapsed,
        });
      const headers = {
        TrackingJournal: [
          "notificationPermission",
          "begin",
          "activate",
          "read",
          "pause",
          "detached",
          "navigation",
          "clear",
          "removeListener",
        ],
        BackgroundGeolocation: ["removeWatcher"],
        Geolocation: ["requestPermissions", "clearWatch"],
        App: ["getLaunchUrl", "removeListener"],
        SpeedTrackVoice: ["available", "speak", "stop"],
      };
      Object.assign(window, {
        androidBridge: {},
        Capacitor: {
          PluginHeaders: Object.entries(headers).map(([name, methods]) => ({
            name,
            methods: [
              ...methods.map((name) => ({ name, rtype: "promise" })),
              { name: "addListener", rtype: "callback" },
              { name: "addWatcher", rtype: "callback" },
              { name: "watchPosition", rtype: "callback" },
            ],
          })),
          nativeCallback: (
            plugin: string,
            method: string,
            options: { eventName?: string },
            callback: () => void,
          ) => {
            if (method === "addListener") {
              listeners.set(`${plugin}:${options.eventName}`, callback);
              return Promise.resolve("listener");
            }
            if (plugin === "BackgroundGeolocation") {
              db.watchers++;
              persist();
              return Promise.resolve(`watch-${db.watchers}`);
            }
            return Promise.resolve("foreground-watch");
          },
          nativePromise: async (
            plugin: string,
            method: string,
            options: Record<string, unknown> = {},
          ) => {
            if (plugin === "SpeedTrackVoice") return { languages: [] };
            if (plugin === "App") return {};
            if (plugin === "Geolocation") {
              if (method === "requestPermissions") db.locationRequests++;
              persist();
              return { location: "granted", coarseLocation: "granted" };
            }
            if (plugin === "BackgroundGeolocation") {
              db.stops++;
              persist();
              return;
            }
            let result: unknown;
            switch (method) {
              case "notificationPermission":
                db.notificationRequests++;
                result = { granted: notifications };
                break;
              case "begin":
                if (db.state) throw new Error("already active");
                db.state = {
                  session: options.session as Record<string, unknown>,
                  elapsed: 0,
                  paused: true,
                  ended: false,
                  watcher: null,
                };
                break;
              case "activate":
                db.state!.paused = false;
                db.state!.watcher = options.watcher as string;
                boundary();
                break;
              case "read":
                result = {
                  state: db.state,
                  rows: deliver
                    ? db.rows
                        .filter((r) => r.seq > Number(options.after))
                        .slice(0, 500)
                    : [],
                };
                break;
              case "pause":
                db.state!.paused = true;
                db.state!.ended = options.ended as boolean;
                boundary();
                break;
              case "detached":
                db.state!.watcher = null;
                break;
              case "navigation":
                db.state!.session.navigation = options.navigation;
                break;
              case "clear":
                db.state = null;
                db.rows = [];
                break;
            }
            persist();
            return structuredClone(result);
          },
        },
        nativeTrackingTest: {
          inspect: () => structuredClone(db),
          hidden: (hidden: boolean) => {
            deliver = !hidden;
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: hidden,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          },
          emit: (meters: number, seconds = 1, accuracy = 5) => {
            db.time += seconds * 1000;
            if (db.state && !db.state.paused && db.state.watcher) {
              db.state.elapsed += seconds;
              db.rows.push({
                seq: db.rows.length + 1,
                kind: "point",
                elapsed: db.state.elapsed,
                receivedAt: db.time,
                point: {
                  timestamp: db.time,
                  latitude: 0,
                  longitude: meters / 111194.9266,
                  accuracy,
                  speed: null,
                },
              });
            }
            persist();
            if (deliver) listeners.get("TrackingJournal:available")?.();
          },
        },
      });
    },
    { notifications },
  );
}
declare global {
  interface Window {
    nativeTrackingTest: {
      hidden(value: boolean): void;
      emit(meters: number, seconds?: number, accuracy?: number): void;
      inspect(): {
        state: { paused: boolean; ended: boolean } | null;
        watchers: number;
        stops: number;
        notificationRequests: number;
        locationRequests: number;
      };
    };
  }
}
async function tab(page: Page, name: string) {
  await page
    .locator(".bottom-nav")
    .getByRole("button", { name, exact: true })
    .click();
}

test("Android consent, background buffer, WebView reload, pause/resume and final durable save", async ({
  page,
}) => {
  await android(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await tab(page, "Actividad");
  expect(
    await page.evaluate(() => window.nativeTrackingTest.inspect()),
  ).toMatchObject({ locationRequests: 0, notificationRequests: 0 });
  await expect(page.getByText(/aunque bloquees la pantalla/)).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Continuar con pantalla bloqueada" })
    .check();
  await page.getByRole("button", { name: "Caminar", exact: true }).click();
  await page
    .getByRole("button", { name: "Iniciar actividad", exact: true })
    .click();
  await expect(
    page.getByText(/Registro Android en segundo plano activo/),
  ).toBeVisible();
  await page.evaluate(() => {
    window.nativeTrackingTest.emit(0);
    window.nativeTrackingTest.hidden(true);
    for (let i = 1; i <= 30; i++) window.nativeTrackingTest.emit(i * 1.4);
  });
  expect(
    await page.evaluate(() => window.nativeTrackingTest.inspect()),
  ).toMatchObject({ state: { paused: false }, watchers: 1 });
  // Recreate only the WebView. Native samples survive and must not add a watcher.
  await page.reload();
  await tab(page, "Actividad");
  await expect(
    page.getByText(/Registro Android en segundo plano activo/),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("speedtrack.draft.local-user")!)
            .distance,
      ),
    )
    .toBeGreaterThan(0.04);
  expect(
    await page.evaluate(() => window.nativeTrackingTest.inspect()),
  ).toMatchObject({ watchers: 1 });
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reanudar", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.nativeTrackingTest.emit(1000, 60));
  await page.getByRole("button", { name: "Reanudar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pausar", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.nativeTrackingTest.emit(1000);
    window.nativeTrackingTest.emit(1004, 3);
  });
  await page.getByRole("button", { name: "Finalizar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Resumen del entrenamiento" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.nativeTrackingTest.inspect()),
  ).toMatchObject({ state: null, watchers: 2, stops: 2 });
  await page.reload();
  await tab(page, "Historial");
  await expect(page.locator(".session-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Android notification refusal falls back to foreground and hiding still pauses", async ({
  page,
}) => {
  await android(page, false);
  await page.goto("/");
  await tab(page, "Actividad");
  await page
    .getByRole("checkbox", { name: "Continuar con pantalla bloqueada" })
    .check();
  await page
    .getByRole("button", { name: "Iniciar actividad", exact: true })
    .click();
  await expect(page.getByText(/No se pudo asegurar/)).toBeVisible();
  expect(
    await page.evaluate(() => window.nativeTrackingTest.inspect()),
  ).toMatchObject({ watchers: 0, notificationRequests: 1 });
  await page.evaluate(() => window.nativeTrackingTest.hidden(true));
  await expect(page.getByRole("heading", { name: "En pausa" })).toBeVisible();
});
