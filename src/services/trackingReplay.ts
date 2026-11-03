import type { Session } from "../types";
import type { GpsPoint } from "./gpsService";
import { GpsFilter } from "../utils/gpsFilter";
import { addMeasurement } from "../utils/physics";

export type TrackingRow = { seq: number; elapsed: number } & (
  { kind: "break" } | { kind: "point"; point: GpsPoint; receivedAt: number }
);

/** Same filter for foreground and buffered samples. Native receipt time checks
 * freshness, not replay time: a valid locked-screen walk is not a stale fix. */
export class TrackingReplay {
  filter = new GpsFilter();
  after = 0;
  waitingFix = true;
  accuracy: number | null = null;
  constructor(public session: Session) {}
  apply(rows: TrackingRow[]) {
    for (const row of rows) {
      if (row.seq <= this.after) continue;
      if (row.kind === "break") {
        this.filter.reset();
        this.waitingFix = true;
      } else {
        this.accuracy = row.point.accuracy;
        const accepted = this.filter.accept(
          row.point,
          this.session.type,
          row.receivedAt,
        );
        if (accepted) {
          this.waitingFix = false;
          this.session = addMeasurement(this.session, {
            id: `${this.session.id}:gps:${row.seq}`,
            session_id: this.session.id,
            timestamp: row.point.timestamp,
            elapsed: row.elapsed,
            latitude: row.point.latitude,
            longitude: row.point.longitude,
            accuracy: row.point.accuracy,
            device_speed: row.point.speed,
            break_before: accepted.breakBefore,
            speed: accepted.speed,
            instantaneous_speed: accepted.instantaneousSpeed,
            acceleration: accepted.acceleration,
            distance: this.session.distance + accepted.delta,
          });
        }
      }
      this.after = row.seq;
    }
    return this.session;
  }
  time(elapsed: number) {
    this.session = {
      ...this.session,
      duration: elapsed,
      avg_speed: elapsed > 0 ? (this.session.distance / elapsed) * 3600 : 0,
    };
    return this.session;
  }
}
