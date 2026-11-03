import type { ActivityType, Session } from "../types";
// Real GPS by default; academic simulation is explicit.
export function newSession(
  type: ActivityType,
  limit: number,
  goal: number | null,
): Session {
  return {
    id: crypto.randomUUID(),
    user_id: "local-user",
    type,
    demo: false,
    limit,
    goal,
    start_time: new Date().toISOString(),
    end_time: null,
    distance: 0,
    duration: 0,
    avg_speed: 0,
    max_speed: 0,
    max_acceleration: 0,
    max_deceleration: 0,
    above_limit: 0,
    measurements: [],
    events: [],
    splits: [],
  };
}
