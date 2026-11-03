import type { ActivityType } from "../types";
import type { GpsPoint } from "../services/gpsService";
import { calculateAcceleration, calculateDistance } from "./physics";
export const ceilings: Record<ActivityType, number> = {
  walk: 15,
  run: 45,
  bike: 110,
  vehicle: 250,
};
export const movementPolicy: Record<
  ActivityType,
  { floor: number; cap: number; fraction: number }
> = {
  walk: { floor: 2, cap: 4, fraction: 0.25 },
  run: { floor: 2.5, cap: 5, fraction: 0.3 },
  bike: { floor: 3, cap: 8, fraction: 0.4 },
  vehicle: { floor: 5, cap: 12, fraction: 0.5 },
};
// Tunable quality policy, not claims about sensor accuracy. See docs/precision-v2.md.
export const gpsPolicy = {
  maxAccuracyM: 35,
  gapSeconds: 15,
  minIntervalSeconds: 0.5,
  smoothingSeconds: 3,
  stationaryHoldSeconds: 3,
  stationaryKmh: 0.7,
  noiseFloorM: 2,
  noiseAccuracyFraction: 0.5,
  maxAccelerationMs2: 6,
  vehicleAccelerationMs2: 12,
};
export class GpsFilter {
  diagnostics = {
    received: 0,
    accepted: 0,
    discarded: 0,
    accuracy: 0,
    reason: "waiting",
    distanceM: 0,
    speedKmh: 0,
  };
  private reject(reason: string) {
    this.diagnostics.reason = reason;
    return null;
  }
  constructor(
    private policy = gpsPolicy,
    private maxSpeeds = ceilings,
  ) {}
  private mode: ActivityType | null = null;
  private instantaneous = 0;
  private previous: GpsPoint | null = null;
  private speed = 0;
  private lastSeen: number | null = null;
  private lastSample: GpsPoint | null = null;
  reset() {
    this.previous = null;
    this.lastSeen = null;
    this.lastSample = null;
    this.speed = 0;
    this.instantaneous = 0;
  }
  accept(p: GpsPoint, mode: ActivityType, now = p.timestamp) {
    this.diagnostics.received++;
    this.diagnostics.accuracy = p.accuracy;
    const result =
      now - p.timestamp > this.policy.gapSeconds * 1000 ||
      p.timestamp - now > 5000
        ? this.reject("stale_timestamp")
        : this.evaluate(p, mode);
    if (result) {
      this.diagnostics.accepted++;
      this.diagnostics.reason = result.breakBefore
        ? "fix"
        : result.delta > 0
          ? "movement"
          : "below_movement_threshold";
    } else this.diagnostics.discarded++;
    this.diagnostics.distanceM = (result?.delta ?? 0) * 1000;
    this.diagnostics.speedKmh = result?.instantaneousSpeed ?? 0;
    return result;
  }
  private evaluate(p: GpsPoint, mode: ActivityType) {
    if (this.mode !== mode) {
      this.reset();
      this.mode = mode;
    }
    if (
      ![p.latitude, p.longitude, p.timestamp, p.accuracy].every(
        Number.isFinite,
      ) ||
      Math.abs(p.latitude) > 90 ||
      Math.abs(p.longitude) > 180 ||
      p.accuracy < 0 ||
      p.accuracy > this.policy.maxAccuracyM
    )
      return this.reject("invalid_or_inaccurate_fix");
    const prev = this.previous;
    if (this.lastSeen !== null && p.timestamp <= this.lastSeen)
      return this.reject("non_monotonic_timestamp");
    const dt = prev ? (p.timestamp - prev.timestamp) / 1000 : 0;
    const sampleDt =
      this.lastSeen === null ? 0 : (p.timestamp - this.lastSeen) / 1000;
    // Reacquire after a signal gap without adding an unobserved straight line.
    if (!prev || sampleDt > this.policy.gapSeconds) {
      this.previous = p;
      this.lastSeen = p.timestamp;
      this.lastSample = p;
      this.speed = 0;
      this.instantaneous = 0;
      return {
        delta: 0,
        speed: 0,
        instantaneousSpeed: 0,
        acceleration: 0,
        breakBefore: true,
      };
    }
    if (sampleDt < this.policy.minIntervalSeconds)
      return this.reject("interval_too_short");
    // Check consecutive observations too: a long stationary anchor must not
    // dilute a sudden jump by dividing it by the entire idle period.
    if (
      this.lastSample &&
      (calculateDistance(this.lastSample, p) / sampleDt) * 3600 >
        this.maxSpeeds[mode]
    )
      return this.reject("implausible_jump");
    const distance = calculateDistance(prev, p);
    const raw = (distance / dt) * 3600;
    if (raw > this.maxSpeeds[mode]) return this.reject("implausible_speed");
    const device =
      p.speed !== null && Number.isFinite(p.speed) && p.speed >= 0
        ? p.speed * 3.6
        : null;
    // Device speed is advisory: some Android providers report zero while walking.
    if (device !== null && device > this.maxSpeeds[mode])
      return this.reject("implausible_device_speed");
    // Keep an anchor until displacement clears uncertainty. Device speed alone
    // must never turn stationary coordinate jitter into accumulated distance.
    const clearanceM = Math.max(
      movementPolicy[mode].floor,
      Math.min(
        movementPolicy[mode].cap,
        Math.min(prev.accuracy, p.accuracy) * movementPolicy[mode].fraction,
      ),
    );
    const stationary = distance * 1000 < clearanceM;
    const rawSpeed = stationary ? 0 : raw; // v = accepted displacement / time
    const maxA =
      mode === "vehicle"
        ? this.policy.vehicleAccelerationMs2
        : this.policy.maxAccelerationMs2;
    if (
      !stationary &&
      Math.abs(calculateAcceleration(this.instantaneous, rawSpeed, sampleDt)) >
        maxA + 1e-6
    )
      return this.reject("implausible_acceleration");
    // El peso depende del tiempo que cubre la medición (desde el ancla), no del
    // intervalo entre fixes: con precisión baja el ancla tarda varios segundos
    // en superar el ruido y una medición de 6 s no debe pesar como una de 1 s.
    const alpha =
      1 - Math.exp(-Math.max(dt, sampleDt) / this.policy.smoothingSeconds);
    // A sub-noise walking step is not evidence of a stop. Hold an established
    // estimate while the anchor gathers displacement, bounded to 3-10 seconds.
    // Zero device speed cannot override confirmed coordinate movement.
    const pendingMotion =
      stationary &&
      this.speed >= this.policy.stationaryKmh &&
      // Tiempo esperado para superar el ruido a la velocidad actual (con
      // margen), entre el mínimo configurado y 10 s.
      dt <=
        Math.min(
          10,
          Math.max(
            this.policy.stationaryHoldSeconds,
            (1.5 * clearanceM) / (this.speed / 3.6),
          ),
        );
    const speed = stationary
      ? pendingMotion
        ? this.speed
        : 0
      : this.speed + alpha * (rawSpeed - this.speed);
    const acceleration = calculateAcceleration(this.speed, speed, sampleDt);
    if (Math.abs(acceleration) > maxA + 1e-6)
      return this.reject("implausible_acceleration");
    if (!stationary) this.previous = p;
    this.lastSeen = p.timestamp;
    this.lastSample = p;
    this.speed = speed;
    this.instantaneous = rawSpeed;
    return {
      delta: stationary ? 0 : distance,
      speed,
      instantaneousSpeed: rawSpeed,
      acceleration,
      breakBefore: false,
    };
  }
}
