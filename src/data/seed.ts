import type { ActivityType, Session } from "../types";
import { addMeasurement, calculateAcceleration } from "../utils/physics";
export function seedSessions(): Session[] {
  const specs: {
    type: ActivityType;
    date: string;
    distance: number;
    duration: number;
    max: number;
  }[] = [
    {
      type: "run",
      date: "2026-10-05T08:00:00-05:00",
      distance: 5.02,
      duration: 1602,
      max: 14.2,
    },
    {
      type: "vehicle",
      date: "2026-10-04T10:00:00-05:00",
      distance: 18.7,
      duration: 2520,
      max: 61,
    },
    {
      type: "bike",
      date: "2026-10-02T07:00:00-05:00",
      distance: 12.3,
      duration: 2280,
      max: 28.1,
    },
  ];
  return specs.map((spec, index) => {
    const id = `seed-${index}`;
    let session: Session = {
      id,
      user_id: "local-user",
      type: spec.type,
      start_time: spec.date,
      end_time: new Date(
        new Date(spec.date).getTime() + spec.duration * 1000,
      ).toISOString(),
      distance: 0,
      duration: 0,
      avg_speed: 0,
      max_speed: 0,
      max_acceleration: 0,
      max_deceleration: 0,
      measurements: [],
      events: [],
      splits: [],
      demo: true,
      limit: 50,
      above_limit: 0,
      goal: null,
    };
    const dt = spec.duration / 84;
    const shape = Array.from({ length: 85 }, (_, i) =>
      i === 0 || i === 84 || i === 40 ? 0 : 1 + Math.sin(i * 0.23) * 0.12,
    );
    const targetSum = (spec.distance * 3600) / dt;
    const scale = (targetSum - spec.max) / shape.reduce((a, b) => a + b, 0);
    const speeds = shape.map((value, i) =>
      i === 40 ? spec.max : value * scale,
    );
    let distance = 0;
    for (let i = 0; i < 85; i++) {
      const dt = spec.duration / 84,
        speed = speeds[i],
        previous = speeds[Math.max(0, i - 1)];
      if (i > 0) distance += (((previous + speed) / 2) * dt) / 3600;
      session = addMeasurement(session, {
        id: `${id}-${i}`,
        session_id: id,
        timestamp: new Date(spec.date).getTime() + i * dt * 1000,
        elapsed: i * dt,
        latitude: -12.12 + distance * 0.004,
        longitude: -77.03 + Math.sin(distance) * 0.003,
        speed,
        acceleration: calculateAcceleration(previous, speed, dt),
        accuracy: null,
        distance,
      });
    }
    return session;
  });
}
