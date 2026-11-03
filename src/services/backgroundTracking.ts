import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import type { NavigationPlan, Session } from "../types";
import { TrackingReplay, type TrackingRow } from "./trackingReplay";

export const backgroundSupported = () => Capacitor.getPlatform() === "android";
export interface NativeTrackingState {
  session: Session;
  elapsed: number;
  paused: boolean;
  ended: boolean;
  watcher: string | null;
  endTime?: string;
}
export interface JournalApi {
  notificationPermission(): Promise<{ granted: boolean }>;
  begin(options: { session: Session }): Promise<void>;
  activate(options: { id: string; watcher: string }): Promise<void>;
  read(options: { owner: string; after: number }): Promise<{
    state: NativeTrackingState | null;
    rows: TrackingRow[];
    storageError?: boolean;
  }>;
  pause(options: { id: string; ended: boolean }): Promise<void>;
  detached(options: { id: string }): Promise<void>;
  navigation(options: {
    id: string;
    navigation: NavigationPlan | null;
  }): Promise<void>;
  clear(options: { id: string }): Promise<void>;
  addListener(
    event: string,
    callback: () => void,
  ): Promise<PluginListenerHandle>;
}
const journal = registerPlugin<JournalApi>("TrackingJournal");
const backgroundGps = registerPlugin<BackgroundGeolocationPlugin>(
  "BackgroundGeolocation",
);
export interface TrackingView {
  session: Session;
  paused: boolean;
  ended: boolean;
  waitingFix: boolean;
  accuracy: number | null;
  diagnostics: TrackingReplay["filter"]["diagnostics"];
}

/** Serial commands + one coalesced drain. Native rows remain until final local
 * save/outbox acknowledgement; JS suspension, reload and repeated callbacks
 * cannot duplicate a measurement or erase an unconsumed sample. */
export class BackgroundTracker {
  private replay: TrackingReplay | null = null;
  private state: NativeTrackingState | null = null;
  private watcher: string | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private polling: Promise<TrackingView | null> | null = null;
  constructor(
    private owner: string,
    private update: (view: TrackingView) => void,
    private error: () => void,
    private api = journal,
    private gps = backgroundGps,
    private permissions = () => Geolocation.requestPermissions(),
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => {});
    return result;
  }
  private async read() {
    let batch;
    do {
      batch = await this.api.read({
        owner: this.owner,
        after: this.replay?.after ?? 0,
      });
      this.state = batch.state;
      if (batch.storageError) this.error();
      if (!batch.state) return null;
      if (!this.replay) this.replay = new TrackingReplay(batch.state.session);
      this.replay.apply(batch.rows);
    } while (batch.rows.length === 500);
    const state = batch.state!;
    this.watcher = state.watcher;
    // An interrupted start/stop may leave a watcher registered while the
    // durable session is paused. Reconcile before allowing another resume.
    if (state.paused && this.watcher) {
      await this.removeWatcher(state.session.id);
      state.watcher = null;
    }
    this.replay!.session = {
      ...this.replay!.session,
      navigation: state.session.navigation ?? undefined,
    };
    const view: TrackingView = {
      session: {
        ...this.replay!.time(state.elapsed),
        end_time: state.endTime ?? null,
      },
      paused: state.paused,
      ended: state.ended,
      waitingFix: this.replay!.waitingFix,
      accuracy: this.replay!.accuracy,
      diagnostics: { ...this.replay!.filter.diagnostics },
    };
    this.update(view);
    return view;
  }
  poll() {
    if (!this.polling)
      this.polling = this.serial(() => this.read()).finally(() => {
        this.polling = null;
      });
    return this.polling;
  }
  async listen() {
    const results = await Promise.all([
      this.api.addListener("available", () => {
        void this.poll().catch(this.error);
      }),
      this.api.addListener("storageError", this.error),
    ]);
    return () => {
      results.forEach((listener) => {
        void listener.remove();
      });
    };
  }
  private async removeWatcher(id: string) {
    if (this.watcher) {
      await this.gps.removeWatcher({ id: this.watcher });
      this.watcher = null;
    }
    await this.api.detached({ id });
  }
  private async watch(id: string, title: string, message: string) {
    this.watcher = await this.gps.addWatcher(
      {
        backgroundTitle: title,
        backgroundMessage: message,
        requestPermissions: false,
        stale: false,
        distanceFilter: 0,
      },
      (_point, error) => {
        if (error) this.error();
      },
    );
    await this.api.activate({ id, watcher: this.watcher });
  }
  start(session: Session, title: string, message: string) {
    return this.serial(async () => {
      if (
        this.state ||
        (await this.api.read({ owner: this.owner, after: 0 })).state
      )
        throw new Error("An unfinished native activity exists");
      const permission = await this.permissions();
      if (permission.location !== "granted") return false;
      if (!(await this.api.notificationPermission()).granted) return false;
      await this.api.begin({ session });
      try {
        await this.watch(session.id, title, message);
        await this.read();
        return true;
      } catch {
        await this.api.pause({ id: session.id, ended: true });
        await this.removeWatcher(session.id);
        await this.api.clear({ id: session.id });
        return false;
      }
    });
  }
  pause(ended = false) {
    return this.serial(async () => {
      if (!this.state) await this.read();
      if (!this.state) return null;
      const id = this.state.session.id;
      // Freeze native acquisition first, then remove sensor/notification, then
      // drain everything that arrived before the freeze. No last-sample race.
      await this.api.pause({ id, ended });
      await this.removeWatcher(id);
      return this.read();
    });
  }
  resume(title: string, message: string) {
    return this.serial(async () => {
      if (!this.state?.paused || this.state.ended) return;
      const id = this.state.session.id;
      await this.removeWatcher(id);
      const permission = await this.permissions();
      if (
        permission.location !== "granted" ||
        !(await this.api.notificationPermission()).granted
      )
        throw new Error("Tracking permission unavailable");
      try {
        await this.watch(id, title, message);
      } catch (error) {
        await this.api.pause({ id, ended: false });
        await this.removeWatcher(id);
        throw error;
      }
      await this.read();
    });
  }
  navigation(navigation: NavigationPlan | undefined) {
    return this.serial(async () => {
      if (this.state)
        await this.api.navigation({
          id: this.state.session.id,
          navigation: navigation ?? null,
        });
    });
  }
  acknowledge(id: string) {
    return this.serial(async () => {
      if (this.state?.session.id !== id) return;
      await this.api.clear({ id });
      this.replay = null;
      this.state = null;
    });
  }
}
